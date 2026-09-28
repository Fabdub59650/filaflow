/**
 * backup.js — Service de sauvegarde automatique de la base de données
 * - Planning configurable via cron expression (ex: "0 2 * * *" = 2h du matin)
 * - Destination locale ou NAS (SMB), un dossier horodaté par sauvegarde
 * - Rétention configurable (nb de sauvegardes conservées)
 * - Sauvegarde manuelle, export complet et restauration via API
 */

const { exec, execSync } = require('child_process');
const { encrypt, decrypt } = require('./crypto');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const db        = require('./db');
const multer    = require('multer');
const restoreUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500*1024*1024 } });

const DEFAULT_BACKUP_PATH    = '/opt/filaflow/backups';
const DEFAULT_SCHEDULE       = '0 2 * * *'; // 2h du matin tous les jours
const DEFAULT_KEEP           = 7;           // 7 fichiers conservés
const INSTALL_DIR            = '/opt/filaflow';

let _cronTimer = null;
let _lastBackup = null;
let _backupStatus   = 'idle'; // 'idle' | 'running' | 'success' | 'error'
let _backupStartedAt = null;
let _lastError = null;

// ── Mode du rapport email : 'always' | 'errors' | 'off' ────
// (compatibilité : l'ancienne valeur 'true' équivaut à 'always')
function reportModeOf(v) {
  if (v === 'always' || v === 'true') return 'always';
  if (v === 'errors') return 'errors';
  return 'off';
}

// ── Lecture des settings ──────────────────────────────────
async function getBackupSettings() {
  try {
    const [rows] = await db.query(
      "SELECT key_name, value FROM settings WHERE key_name LIKE 'backup_%'"
    );
    const s = {};
    rows.forEach(r => { s[r.key_name] = r.value; });
    return {
      enabled:         s.backup_enabled === 'true',
      path:            s.backup_path     || DEFAULT_BACKUP_PATH,
      schedule:        s.backup_schedule || DEFAULT_SCHEDULE,
      keep:            parseInt(s.backup_keep) || DEFAULT_KEEP,
      // NAS
      destination:     s.backup_destination  || 'local',
      nasIp:           s.backup_nas_ip       || '',
      nasShare:        s.backup_nas_share    || '',
      nasUser:         s.backup_nas_user     || '',
      nasPassword:     s.backup_nas_password ? (function(){ try{ return decrypt(s.backup_nas_password); }catch(_){ return s.backup_nas_password; } })() : '',
      nasFolder:       s.backup_nas_folder   || '/filaflow',
      reportMode:      reportModeOf(s.backup_report_email),
    };
  } catch (_) {
    return { enabled: false, path: DEFAULT_BACKUP_PATH, schedule: DEFAULT_SCHEDULE,
             keep: DEFAULT_KEEP,
             destination: 'local', nasIp:'', nasShare:'', nasUser:'', nasPassword:'',
             nasFolder:'/filaflow', reportMode: 'off' };
  }
}

// ── Lecture config MariaDB depuis .env ────────────────────
function getDbConfig() {
  return {
    host:   process.env.DB_HOST     || 'localhost',
    user:   process.env.DB_USER     || 'filaflow',
    pass:   process.env.DB_PASSWORD || 'filaflow_secret',
    name:   process.env.DB_NAME     || 'filaflow',
  };
}

// ── Montage NAS SMB ───────────────────────────────────────
function mountNas(cfg, mountPoint) {
  return new Promise(function(resolve, reject) {
    try { execSync('umount -l "' + mountPoint + '" 2>/dev/null'); } catch(_) {}
    fs.mkdirSync(mountPoint, { recursive: true });
    const share = '//' + cfg.nasIp + '/' + cfg.nasShare;

    const opts = ['iocharset=utf8','file_mode=0755','dir_mode=0755','vers=3.0'];

    if (cfg.nasUser) {
      // Écrire fichier credentials — format strict attendu par mount.cifs
      const credFile = '/tmp/pf_nas_' + Date.now();
      const lines = ['username=' + cfg.nasUser];
      if (cfg.nasPassword) lines.push('password=' + cfg.nasPassword);
      fs.writeFileSync(credFile, lines.join('\n') + '\n', { mode: 0o600 });
      opts.push('credentials=' + credFile);

      const cmd = 'mount -t cifs "' + share + '" "' + mountPoint + '" -o ' + opts.join(',');
      console.log('[Backup] Montage NAS :', share, '(credentials file)');
      exec(cmd, { timeout: 30000 }, function(err) {
        try { fs.unlinkSync(credFile); } catch(_) {}
        if (err) {
          console.error('[Backup] Erreur montage NAS :', err.message.split('\n')[0]);
          reject(new Error('Erreur montage NAS : ' + err.message.split('\n')[0]));
        } else {
          console.log('[Backup] NAS monté avec succès');
          resolve();
        }
      });
    } else {
      opts.push('guest');
      const cmd = 'mount -t cifs "' + share + '" "' + mountPoint + '" -o ' + opts.join(',');
      exec(cmd, { timeout: 30000 }, function(err) {
        if (err) reject(new Error('Erreur montage NAS : ' + err.message.split('\n')[0]));
        else resolve();
      });
    }
  });
}

function unmountNas(mountPoint) {
  try { execSync('umount -l "' + mountPoint + '" 2>/dev/null'); } catch(_) {}
  try { fs.rmdirSync(mountPoint); } catch(_) {}
}

function getDirSize(dir) {
  try {
    const out = execSync('du -sb "' + dir + '" 2>/dev/null || echo 0').toString();
    return parseInt(out.split('\t')[0]) || 0;
  } catch(_) { return 0; }
}

// ── Effectuer une sauvegarde ──────────────────────────────
async function runBackup() {
  const settings  = await getBackupSettings();
  const dbConf    = getDbConfig();
  const startTime = Date.now();

  const now    = new Date();
  const stamp  = now.toISOString().slice(0,10) + '_' +
                 String(now.getHours()).padStart(2,'0') + '-' +
                 String(now.getMinutes()).padStart(2,'0');

  const report = {
    stamp, success: false, error: null, type: 'Complète',
    date: now.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'}),
    time: String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'),
    dbSize: 0,
    totalSize: 0, deleted: [], destination: '', duration: 0,
  };

  let mountPoint = null;
  let backupRoot = null;

  _backupStatus = 'running';
  _backupStartedAt = Date.now();
  console.log('[Backup] Démarrage sauvegarde', new Date().toISOString());

  try {
    // ── Destination ──────────────────────────────────────
    if (settings.destination === 'nas') {
      if (!settings.nasIp || !settings.nasShare)
        throw new Error('Configuration NAS incomplète (IP ou partage manquant)');
      mountPoint = '/tmp/filaflow_nas_' + Date.now();
      await mountNas(settings, mountPoint);
      backupRoot = path.join(mountPoint, settings.nasFolder.replace(/^\//, ''));
      report.destination = '//' + settings.nasIp + '/' + settings.nasShare + settings.nasFolder;
    } else {
      backupRoot = settings.path;
      report.destination = settings.path;
    }
    fs.mkdirSync(backupRoot, { recursive: true });

    const destDir = path.join(backupRoot, stamp);
    fs.mkdirSync(destDir, { recursive: true });

    // ── 1. Base de données (toujours complète, compressée) ─
    const dbFile = path.join(destDir, 'database.sql.gz');
    await new Promise(function(resolve, reject) {
      // pipefail : sans lui, un échec de mysqldump est masqué par le succès de gzip
      const cmd = 'set -o pipefail; mysqldump -h' + dbConf.host + ' -u' + dbConf.user +
        ' -p' + dbConf.pass + ' --single-transaction ' + dbConf.name +
        ' | gzip > "' + dbFile + '"';
      // Message d'erreur = stderr seul (la commande contient le mot de passe de la base)
      exec(cmd, { shell: '/bin/bash' }, function(err, stdout, stderr){
        if (err) reject(new Error('Dump de la base échoué : ' + ((stderr || '').trim() || 'code ' + err.code)));
        else resolve();
      });
    }).catch(function(e) {
      try { fs.rmSync(destDir, { recursive: true, force: true }); } catch(_) {}  // pas de dossier vide compté dans la rétention
      throw e;
    });
    report.dbSize = fs.statSync(dbFile).size;
    if (report.dbSize < 200) {
      try { fs.rmSync(destDir, { recursive: true, force: true }); } catch(_) {}
      throw new Error('Dump de la base vide ou incomplet (' + report.dbSize + ' octets)');
    }

    // ── Manifest ────────────────────────────────────────
    fs.writeFileSync(path.join(destDir,'manifest.json'), JSON.stringify({
      stamp, date: now.toISOString(), type: report.type,
      dbSize: report.dbSize,
    }, null, 2));

    // Enregistrer les métadonnées en BDD pour affichage même si NAS non monté
    const metaKey = 'backup_meta_' + stamp;
    const metaVal = JSON.stringify({
      stamp, date: now.toISOString(), type: report.type,
      dbSize: report.dbSize,
      destination: report.destination,
    });
    await db.query(
      'INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
      [metaKey, metaVal, metaVal]
    ).catch(function(){});

    // ── Rétention ────────────────────────────────────────
    const allDirs = fs.readdirSync(backupRoot)
      .filter(function(d){ return /^\d{4}-\d{2}-\d{2}_/.test(d); })
      .filter(function(d){ return fs.statSync(path.join(backupRoot,d)).isDirectory(); })
      .sort();
    if (allDirs.length > settings.keep) {
      const toDelete = allDirs.slice(0, allDirs.length - settings.keep);
      for (const dir of toDelete) {
        await new Promise(function(resolve){
          exec('rm -rf "' + path.join(backupRoot, dir) + '"', resolve);
        });
        report.deleted.push(dir);
        console.log('[Backup] Supprimé (rétention) :', dir);
        // Supprimer aussi les métadonnées BDD
        await db.query(
          "DELETE FROM settings WHERE key_name=?", ['backup_meta_' + dir]
        ).catch(function(){});
      }
    }

    report.totalSize = getDirSize(backupRoot);
    report.success   = true;
    _backupStatus    = 'success';
    _lastBackup      = { stamp, date: now.toISOString(), dbSize: report.dbSize };
    _lastError       = null;
    console.log('[Backup] OK —', stamp, '(' + Math.round((Date.now()-startTime)/1000) + 's)');

  } catch(e) {
    report.error  = e.message;
    report.success = false;
    _backupStatus = 'error';
    _lastError    = e.message;
    console.error('[Backup] ERREUR :', e.message);
  } finally {
    if (mountPoint) unmountNas(mountPoint);
  }

  report.duration = Math.round((Date.now() - startTime) / 1000);

  // Sauvegarder le statut
  await db.query(
    'INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
    ['backup_last_run', now.toISOString(), now.toISOString()]
  ).catch(function(){});
  await db.query(
    'INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
    ['backup_last_status', report.success ? 'ok' : 'error:'+report.error,
     report.success ? 'ok' : 'error:'+report.error]
  ).catch(function(){});

  // Rapport email (sans bloquer ni faire échouer la sauvegarde)
  if (settings.reportMode === 'always' || (settings.reportMode === 'errors' && !report.success)) {
    require('./mailer').sendBackupReport(report).catch(function(e) {
      console.error('[Backup] Rapport email non envoyé :', e.message);
    });
  }

  return report;
}

// ── Parser une expression cron simple (min heure * * *) ──
function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [min, hour] = parts;
  const m = parseInt(min),  h = parseInt(hour);
  if (isNaN(m) || isNaN(h)) return null;
  return { hour: h, minute: m };
}

// ── Calculer le prochain déclenchement ────────────────────
function nextTrigger(schedule) {
  const parsed = parseCron(schedule);
  if (!parsed) return null;
  const now  = new Date();
  const next = new Date();
  next.setHours(parsed.hour, parsed.minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

// ── Démarrer le planificateur ─────────────────────────────
function scheduleTick(settings) {
  if (_cronTimer) clearTimeout(_cronTimer);
  if (!settings.enabled) return;

  const next = nextTrigger(settings.schedule);
  if (!next) return;

  const delay = next.getTime() - Date.now();
  console.log(`[Backup] Prochaine sauvegarde : ${next.toLocaleString('fr-FR')} (dans ${Math.round(delay/60000)} min)`);

  _cronTimer = setTimeout(async () => {
    try { await runBackup(); } catch (_) {}
    // Replanifier pour le lendemain
    const newSettings = await getBackupSettings();
    scheduleTick(newSettings);
  }, delay);
}

// ── Démarrer le service ───────────────────────────────────
async function startBackup() {
  const settings = await getBackupSettings();
  if (settings.enabled) {
    console.log('[Backup] Service démarré — schedule:', settings.schedule);
    scheduleTick(settings);
  } else {
    console.log('[Backup] Service désactivé');
  }
}

// ── Redémarrer après changement de settings ───────────────
async function restartScheduler() {
  if (_cronTimer) { clearTimeout(_cronTimer); _cronTimer = null; }
  const settings = await getBackupSettings();
  if (settings.enabled) scheduleTick(settings);
}

// ── Routes API ────────────────────────────────────────────
function setupRoutes(router) {

  // GET /api/backup/status
  router.get('/status', async (req, res) => {
    try {
      const settings = await getBackupSettings();
      const next     = settings.enabled ? nextTrigger(settings.schedule) : null;
      // Lister les sauvegardes (dossiers horodatés)
      let backups = [];
      try {
        // Lire depuis la BDD en priorité (fonctionne même si NAS non monté)
        const [metaRows] = await db.query(
          "SELECT key_name, value FROM settings WHERE key_name LIKE 'backup_meta_%' ORDER BY key_name DESC LIMIT 20"
        );
        if (metaRows.length > 0) {
          backups = metaRows.map(function(r) {
            try { return JSON.parse(r.value); } catch(_) { return { stamp: r.key_name.replace('backup_meta_','') }; }
          });
        } else {
          // Fallback lecture dossier local
          const root = settings.path;
          if (fs.existsSync(root)) {
            backups = fs.readdirSync(root)
              .filter(function(d){ return /^\d{4}-\d{2}-\d{2}_/.test(d); })
              .filter(function(d){ return fs.statSync(path.join(root,d)).isDirectory(); })
              .sort().reverse()
              .map(function(d) {
                const manifest = path.join(root, d, 'manifest.json');
                let info = { stamp: d };
                try { info = Object.assign(info, JSON.parse(fs.readFileSync(manifest))); } catch(_) {}
                return info;
              });
          }
        }
      } catch(_) {}
      // Lire les métadonnées des sauvegardes depuis la BDD (fonctionne même si NAS non monté)
      const backupRootForList = settings.path || DEFAULT_BACKUP_PATH;
      const [[lastRun]]    = await db.query("SELECT value FROM settings WHERE key_name='backup_last_run'").catch(function(){ return [[null]]; });
      const [[lastStatus]] = await db.query("SELECT value FROM settings WHERE key_name='backup_last_status'").catch(function(){ return [[null]]; });
      res.json({
        enabled:     settings.enabled,
        schedule:    settings.schedule,
        keep:        settings.keep,
        path:        settings.path,
        destination: settings.destination,
        nasIp:       settings.nasIp,
        nasShare:    settings.nasShare,
        nasFolder:   settings.nasFolder,
        reportMode:  settings.reportMode,
        status:      _backupStatus,
        lastBackup:  _lastBackup,
        lastError:   _lastError,
        lastRun:     lastRun?.value || null,
        lastStatus:  lastStatus?.value || null,
        nextBackup:  next ? next.toISOString() : null,
        backups,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/backup/reset — réinitialiser le verrou si bloqué
  router.post('/reset', async (req, res) => {
    console.log('[Backup] Reset manuel du verrou (était:', _backupStatus, ')');
    _backupStatus    = 'idle';
    _backupStartedAt = null;
    res.json({ ok: true, message: 'Verrou réinitialisé' });
  });

  // POST /api/backup/run — sauvegarde manuelle
  router.post('/run', async (req, res) => {
    // Reset automatique si bloqué depuis > 30 minutes
    if (_backupStatus === 'running') {
      const elapsed = _backupStartedAt ? Date.now() - _backupStartedAt : Infinity;
      if (elapsed > 30 * 60 * 1000) {
        console.warn('[Backup] Verrou bloqué depuis ' + Math.round(elapsed/60000) + 'min — reset automatique');
        _backupStatus = 'idle';
        _backupStartedAt = null;
      } else {
        return res.status(409).json({ error: 'Sauvegarde déjà en cours' });
      }
    }
    try {
      const result = await runBackup();
      res.json({ ok: true, backup: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/backup/settings — mettre à jour et replanifier
  router.post('/settings', async (req, res) => {
    try {
      const b = req.body;
      // Seuls les champs présents dans la requête sont écrits : un appel partiel
      // (ex. { enabled } depuis l'interrupteur) ne réinitialise pas le reste.
      const has = function(k) { return Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined; };
      const entries = [
        ['backup_enabled',       has('enabled')     ? String(b.enabled) : undefined],
        ['backup_path',          has('path')        ? (b.path || DEFAULT_BACKUP_PATH) : undefined],
        ['backup_schedule',      has('schedule')    ? (b.schedule || DEFAULT_SCHEDULE) : undefined],
        ['backup_keep',          has('keep')        ? String(parseInt(b.keep) || DEFAULT_KEEP) : undefined],
        ['backup_destination',   has('destination') ? (b.destination || 'local') : undefined],
        ['backup_nas_ip',        has('nasIp')       ? (b.nasIp || '') : undefined],
        ['backup_nas_share',     has('nasShare')    ? (b.nasShare || '') : undefined],
        ['backup_nas_user',      has('nasUser')     ? (b.nasUser || '') : undefined],
        ['backup_nas_password',  has('nasPassword') ? encrypt(b.nasPassword) : undefined],
        ['backup_nas_folder',    has('nasFolder')   ? (b.nasFolder || '/filaflow') : undefined],
        ['backup_report_email',  has('reportMode')  ? reportModeOf(b.reportMode) : undefined],
        // Email (SMTP) — mot de passe chiffré, conservé si non fourni
        ['smtp_host',            has('smtpHost')     ? String(b.smtpHost).trim() : undefined],
        ['smtp_port',            has('smtpPort')     ? String(parseInt(b.smtpPort) || 587) : undefined],
        ['smtp_secure',          has('smtpSecure')   ? String(b.smtpSecure === true || b.smtpSecure === 'true') : undefined],
        ['smtp_user',            has('smtpUser')     ? String(b.smtpUser).trim() : undefined],
        ['smtp_password',        has('smtpPassword') ? encrypt(b.smtpPassword) : undefined],
        ['smtp_from',            has('smtpFrom')     ? String(b.smtpFrom).trim() : undefined],
        ['report_email',         has('reportTo')     ? String(b.reportTo).trim() : undefined],
      ];
      for (const [k, v] of entries) {
        if (v === undefined) continue; // Ne pas écraser si non fourni
        await db.query(
          'INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
          [k, v, v]
        );
      }
      await restartScheduler();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/backup/test-mail — envoyer un email de test
  router.post('/test-mail', async (req, res) => {
    try {
      const to = await require('./mailer').sendTestMail(req.body || {});
      res.json({ ok: true, message: 'Email de test envoyé à ' + to });
    } catch (e) {
      res.json({ ok: false, message: e.message });
    }
  });

  // POST /api/backup/test-nas — tester la connexion NAS
  router.post('/test-nas', async (req, res) => {
    const { nasIp, nasShare, nasUser, nasPassword, nasFolder } = req.body;
    if (!nasIp || !nasShare)
      return res.status(400).json({ ok: false, message: 'IP et partage requis' });
    const mountPoint = '/tmp/filaflow_nas_test_' + Date.now();
    try {
      await mountNas({ nasIp, nasShare, nasUser, nasPassword }, mountPoint);
      // Test écriture
      const folder = path.join(mountPoint, (nasFolder||'filaflow').replace(/^\//, ''));
      fs.mkdirSync(folder, { recursive: true });
      const testFile = path.join(folder, '.filaflow_test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      unmountNas(mountPoint);
      res.json({ ok: true, message: 'Connexion NAS réussie — accès en lecture/écriture confirmé' });
    } catch(e) {
      unmountNas(mountPoint);
      res.json({ ok: false, message: e.message });
    }
  });

  // GET /api/backup/export-full — export complet BDD + config en .tar.gz
  router.get('/export-full', async (req, res) => {
    const fs      = require('fs');
    const { spawn } = require('child_process');
    const dbConf    = getDbConfig();

    const now    = new Date();
    const stamp  = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const tmpDir = path.join('/tmp', 'pf_exp_' + stamp);

    try {
      fs.mkdirSync(tmpDir, { recursive: true });

      // 1. Dump BDD
      const credsFile = path.join(tmpDir, '.my.cnf');
      fs.writeFileSync(credsFile,
        `[client]\nhost=${dbConf.host}\nuser=${dbConf.user}\npassword=${dbConf.pass}\n`,
        { mode: 0o600 }
      );
      const sqlFile = path.join(tmpDir, 'database.sql');
      await new Promise((resolve, reject) => {
        const dump = spawn('mysqldump', [
          `--defaults-file=${credsFile}`, dbConf.name
        ]);
        const out = fs.createWriteStream(sqlFile);
        dump.stdout.pipe(out);
        dump.on('close', code => code === 0 ? resolve() : reject(new Error('mysqldump échoué: ' + code)));
        dump.on('error', reject);
      });
      try { fs.unlinkSync(credsFile); } catch(_) {}

      // 2. Config JSON
      const [settingRows] = await db.query('SELECT key_name, value FROM settings');
      const configObj = {};
      settingRows.forEach(r => {
        if (!['auth_password','backup_nas_password','tigertag_webhook_token'].includes(r.key_name)) {
          configObj[r.key_name] = r.value;
        }
      });
      configObj._export_date    = now.toISOString();
      configObj._export_version = (function(){ try { return require('./package.json').version; } catch(_) { return 'inconnue'; } })();
      fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(configObj, null, 2));

      // 3. Construire la commande tar en streaming direct vers HTTP
      const filename = 'filaflow_export_' + stamp + '.tar.gz';
      const tarArgs  = ['-czf', '-', '-C', path.dirname(tmpDir), path.basename(tmpDir)];

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/gzip');

      const tar = spawn('tar', tarArgs, { maxBuffer: 512 * 1024 * 1024 });
      tar.stdout.pipe(res);

      tar.on('close', () => {
        try { execSync(`rm -rf "${tmpDir}"`); } catch(_) {}
      });

      tar.on('error', (e) => {
        console.error('[Export] Erreur tar:', e.message);
        try { execSync(`rm -rf "${tmpDir}"`); } catch(_) {}
        if (!res.headersSent) res.status(500).json({ error: e.message });
      });

      res.on('close', () => {
        try { tar.kill(); } catch(_) {}
        try { execSync(`rm -rf "${tmpDir}"`); } catch(_) {}
      });

    } catch(e) {
      try { execSync(`rm -rf "${tmpDir}"`); } catch(_) {}
      console.error('[Export] Erreur:', e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });


  // POST /api/backup/restore — restaurer BDD depuis .sql ou export complet .tar.gz
  router.post('/restore', restoreUpload.single('backup'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier recu' });
    const filename = req.file.originalname;
    const buffer   = req.file.buffer;
    // Lire config DB depuis .env
    const cfg = { user: 'filaflow', password: '', database: 'filaflow' };
    try {
      const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
      envContent.split('\n').forEach(function(line) {
        const eq = line.indexOf('=');
        if (eq < 0) return;
        const k = line.substring(0, eq).trim();
        const v = line.substring(eq + 1).trim();
        if (k === 'DB_USER')     cfg.user     = v;
        if (k === 'DB_PASSWORD') cfg.password = v;
        if (k === 'DB_NAME')     cfg.database = v;
      });
    } catch(_) {}

    const runSQL = function(sqlPath) {
      return new Promise(function(resolve, reject) {
        exec('mysql -u' + cfg.user + ' -p' + cfg.password + ' ' + cfg.database + ' < "' + sqlPath + '"',
          function(err) { if (err) reject(new Error(err.message)); else resolve(); });
      });
    };

    try {
      // Cas 1 : fichier .sql
      if (filename.endsWith('.sql')) {
        const tmpSql = path.join(os.tmpdir(), 'pf_restore_' + Date.now() + '.sql');
        fs.writeFileSync(tmpSql, buffer);
        try { await runSQL(tmpSql); } finally { try { fs.unlinkSync(tmpSql); } catch(_) {} }
        return res.json({ ok: true, type: 'sql', message: 'Base de donnees restauree' });
      }
      // Cas 2 : archive .tar.gz
      if (filename.endsWith('.tar.gz')) {
        const tmpDir = path.join(os.tmpdir(), 'pf_restore_' + Date.now());
        const tmpTar = tmpDir + '.tar.gz';
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(tmpTar, buffer);
        await new Promise(function(resolve, reject) {
          exec('tar -xzf "' + tmpTar + '" -C "' + tmpDir + '"',
            function(err) { if (err) reject(new Error(err.message)); else resolve(); });
        });
        // Chercher le fichier SQL récursivement
        var walk = function(dir) {
          var out = [];
          fs.readdirSync(dir).forEach(function(f) {
            var p = path.join(dir, f);
            if (fs.statSync(p).isDirectory()) out = out.concat(walk(p));
            else out.push(p);
          });
          return out;
        };
        var files   = walk(tmpDir);
        var sqlFile = files.find(function(f) { return f.endsWith('.sql'); });
        if (!sqlFile) {
          fs.rmSync(tmpDir, { recursive: true }); fs.unlinkSync(tmpTar);
          return res.status(400).json({ error: 'Pas de fichier SQL dans archive' });
        }
        try { await runSQL(sqlFile); } catch(e) {
          fs.rmSync(tmpDir, { recursive: true }); fs.unlinkSync(tmpTar); throw e;
        }
        fs.rmSync(tmpDir, { recursive: true }); fs.unlinkSync(tmpTar);
        return res.json({ ok: true, type: 'full', message: 'Restauration complete (BDD)' });
      }
      return res.status(400).json({ error: 'Format non supporte (.sql ou .tar.gz uniquement)' });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  return router;
}

module.exports = { startBackup, setupRoutes, restartScheduler };
