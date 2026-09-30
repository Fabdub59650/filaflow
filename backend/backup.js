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

// ── Configuration système du Pi (archive system.tar.gz) ───
// Tout ce qu'il faut pour reconstruire le Pi sur une carte SD neuve, en plus
// de la base : Nginx (sites, certificats), .env de FilaFlow (identifiants de la
// base et clé de chiffrement des mots de passe NAS/SMTP), stack Docker Adminer,
// service systemd, réseau, crontabs… Les chemins absents sont ignorés.
const SYSTEM_PATHS = [
  'etc/nginx',
  'opt/filaflow/backend/.env',
  'opt/stacks',
  'etc/mysql',
  'etc/systemd/system/filaflow.service',
  'opt/prepflow/backend/.env',
  'etc/systemd/system/prepflow.service',
  'etc/log2ram.conf',
  'etc/hostname',
  'etc/hosts',
  'etc/fstab',
  'etc/NetworkManager/system-connections',
  'etc/dhcpcd.conf',
  'boot/firmware/config.txt',
  'boot/firmware/cmdline.txt',
  'var/spool/cron/crontabs',
  'home/pi/.ssh/authorized_keys',
  'home/pi/.gitconfig',
];

const SYSTEM_README = [
  'SAUVEGARDE SYSTÈME FILAFLOW',
  '===========================',
  '',
  'Contenu : fichiers de configuration du Pi (chemins relatifs à la racine /),',
  'system-info.txt (inventaire : paquets, services, conteneurs, versions).',
  'Les bases de données sont à côté : database.sql.gz (FilaFlow), prepflow.sql.gz (PrepFlow).',
  '',
  'ATTENTION : cette archive contient des secrets (clé privée du certificat,',
  'mots de passe de la base et du Wi-Fi, clé de chiffrement). À garder sur le NAS.',
  '',
  'Procédure détaillée : docs/RECONSTRUCTION.md dans le dépôt GitHub',
  '  https://github.com/Fabdub59650/filaflow/blob/main/docs/RECONSTRUCTION.md',
  '',
  'Résumé, sur une carte SD neuve (Raspberry Pi OS 64 bits) :',
  "  1. Même nom d'hôte et même IP, activer SSH",
  '  2. Extraire dans un dossier de travail, JAMAIS directement dans / :',
  '       mkdir -p ~/restore/sys && sudo tar -xzf system.tar.gz -C ~/restore/sys',
  '     puis installer Docker, Cockpit et log2ram, et redémarrer (voir la procédure)',
  '  3. Copier opt/filaflow/backend/.env dans /opt/filaflow/backend/ AVANT install.sh',
  '     puis : git clone du dépôt ; sudo DB_PASS=<DB_PASSWORD du .env> bash scripts/install.sh',
  '  4. Recopier les autres fichiers utiles depuis ~/restore/sys :',
  '       etc/nginx/sites-available/, etc/nginx/ssl/, etc/nginx/snippets/',
  '       opt/stacks/ puis : cd /opt/stacks/adminer && sudo docker compose up -d',
  '  5. Restaurer la base : gunzip -c database.sql.gz | sudo mariadb filaflow',
  '     PrepFlow (si présent) : .env de opt/prepflow/backend/ en place, install.sh de PrepFlow,',
  '     puis : gunzip -c prepflow.sql.gz | sudo mariadb prepflow',
  '  6. sudo systemctl restart filaflow nginx',
  "  Paquets et services d'origine : voir system-info.txt",
  '',
].join('\n');

function systemInfo() {
  const { execSync } = require('child_process');
  const run = function(label, cmd) {
    let out;
    try { out = execSync('{ ' + cmd + '; } 2>&1; true', { timeout: 15000, shell: '/bin/bash' }).toString().trim(); }
    catch (e) { out = '(indisponible)'; }
    return '### ' + label + '\n' + out + '\n';
  };
  return [
    'Généré le ' + new Date().toISOString() + '\n',
    run('Système',           'grep PRETTY_NAME /etc/os-release; uname -a'),
    run('Réseau',            'hostname; hostname -I'),
    run('Versions',          'node -v; mariadb --version; nginx -v 2>&1; docker --version'),
    run('Services activés',  'systemctl list-unit-files --type=service --state=enabled --no-legend'),
    run('Conteneurs Docker', "docker ps -a --format '{{.Names}}  {{.Image}}  {{.Ports}}'"),
    run('Paquets installés manuellement (apt)', 'apt-mark showmanual'),
  ].join('\n');
}

async function backupSystem(destDir) {
  const tmp = fs.mkdtempSync('/tmp/ff_sys_');
  try {
    fs.writeFileSync(path.join(tmp, 'LISEZMOI.txt'), SYSTEM_README);
    fs.writeFileSync(path.join(tmp, 'system-info.txt'), systemInfo());
    const present = SYSTEM_PATHS.filter(function(p) { return fs.existsSync('/' + p); });
    const out  = path.join(destDir, 'system.tar.gz');
    const args = ['-czf', out, '--ignore-failed-read', '-C', tmp, 'LISEZMOI.txt', 'system-info.txt', '-C', '/']
      .concat(present);
    await new Promise(function(resolve, reject) {
      require('child_process').execFile('tar', args, { timeout: 120000 }, function(err, stdout, stderr) {
        if (err) reject(new Error((stderr || '').trim() || err.message)); else resolve();
      });
    });
    try { fs.chmodSync(out, 0o600); } catch (_) {}   // contient des secrets
    return { size: fs.statSync(out).size, count: present.length };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Bases des applications voisines (PrepFlow…) ───────────
// Chaque base est sauvegardée avec les identifiants du .env de son application.
// Si l'application n'est pas installée (.env absent), elle est simplement ignorée.
// Un échec n'annule pas la sauvegarde de FilaFlow : il est signalé dans le rapport.
const EXTRA_DATABASES = [
  { key: 'prepflow', label: 'PrepFlow', file: 'prepflow.sql.gz', env: '/opt/prepflow/backend/.env' },
];

function readEnvFile(file) {
  const out = {};
  fs.readFileSync(file, 'utf8').split('\n').forEach(function(line) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return out;
}

async function dumpExtraDatabase(entry, destDir) {
  if (!fs.existsSync(entry.env)) return { skipped: true };
  const env  = readEnvFile(entry.env);
  const name = env.DB_NAME || entry.key;
  const user = env.DB_USER || entry.key;
  if (!env.DB_PASSWORD) throw new Error('DB_PASSWORD absent de ' + entry.env);
  const out = path.join(destDir, entry.file);
  await new Promise(function(resolve, reject) {
    // Mot de passe passé par MYSQL_PWD : il n'apparaît ni dans la ligne de commande ni dans les erreurs
    require('child_process').execFile('/bin/bash',
      ['-c', 'set -o pipefail; mysqldump -h"$1" -u"$2" --single-transaction "$3" | gzip > "$4"',
       'dump', env.DB_HOST || 'localhost', user, name, out],
      { env: Object.assign({}, process.env, { MYSQL_PWD: env.DB_PASSWORD }), timeout: 120000 },
      function(err, stdout, stderr) {
        if (err) reject(new Error((stderr || '').trim() || 'code ' + err.code)); else resolve();
      });
  }).catch(function(e) {
    try { fs.rmSync(out, { force: true }); } catch(_) {}
    throw e;
  });
  const size = fs.statSync(out).size;
  if (size < 200) {
    try { fs.rmSync(out, { force: true }); } catch(_) {}
    throw new Error('Dump vide ou incomplet (' + size + ' octets)');
  }
  return { size: size };
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
    stamp, success: false, error: null, systemError: null, type: 'Complète',
    date: now.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'}),
    time: String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'),
    dbSize: 0, systemSize: 0, extras: [],
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

    // ── Configuration système (non bloquant : signalé dans le rapport) ──
    try {
      report.systemSize = (await backupSystem(destDir)).size;
    } catch (e) {
      report.systemError = e.message;
      console.error('[Backup] Configuration système non sauvegardée :', e.message);
    }

    // ── Bases des applications voisines (non bloquant) ──
    for (const entry of EXTRA_DATABASES) {
      const item = { key: entry.key, label: entry.label, file: entry.file, size: 0, error: null, skipped: false };
      try {
        const r = await dumpExtraDatabase(entry, destDir);
        if (r.skipped) item.skipped = true; else item.size = r.size;
      } catch (e) {
        item.error = e.message;
        console.error('[Backup] Base ' + entry.label + ' non sauvegardée :', e.message);
      }
      report.extras.push(item);
    }
    const extraSizes = {};
    report.extras.forEach(function(x) { if (!x.skipped) extraSizes[x.key + 'Size'] = x.size; });

    // ── Manifest ────────────────────────────────────────
    fs.writeFileSync(path.join(destDir,'manifest.json'), JSON.stringify(Object.assign({
      stamp, date: now.toISOString(), type: report.type,
      dbSize: report.dbSize, systemSize: report.systemSize,
    }, extraSizes), null, 2));

    // Enregistrer les métadonnées en BDD pour affichage même si NAS non monté
    const metaKey = 'backup_meta_' + stamp;
    const metaVal = JSON.stringify(Object.assign({
      stamp, date: now.toISOString(), type: report.type,
      dbSize: report.dbSize, systemSize: report.systemSize,
      destination: report.destination,
    }, extraSizes));
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
