/**
 * backup.js — Service de sauvegarde automatique de la base de données
 * - Planning configurable via cron expression (ex: "0 2 * * *" = 2h du matin)
 * - Rétention configurable (nb de fichiers à conserver)
 * - Dossier de sauvegarde configurable depuis les paramètres
 * - Sauvegarde manuelle possible via API
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
const DEFAULT_LIBRARY_PATH   = process.env.LIBRARY_PATH || '/opt/filaflow/library';
const INSTALL_DIR            = '/opt/filaflow';

let _cronTimer = null;
let _lastBackup = null;
let _backupStatus   = 'idle'; // 'idle' | 'running' | 'success' | 'error'
let _backupStartedAt = null;
let _lastError = null;

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
      libraryEnabled:  s.backup_library_enabled !== 'false',
      libraryPath:     s.library_path || DEFAULT_LIBRARY_PATH,
      // NAS
      destination:     s.backup_destination  || 'local',
      nasIp:           s.backup_nas_ip       || '',
      nasShare:        s.backup_nas_share    || '',
      nasUser:         s.backup_nas_user     || '',
      nasPassword:     s.backup_nas_password ? (function(){ try{ return decrypt(s.backup_nas_password); }catch(_){ return s.backup_nas_password; } })() : '',
      nasFolder:       s.backup_nas_folder   || '/filaflow',
      reportEmail:     s.backup_report_email !== 'false',
    };
  } catch (_) {
    return { enabled: false, path: DEFAULT_BACKUP_PATH, schedule: DEFAULT_SCHEDULE,
             keep: DEFAULT_KEEP, libraryEnabled: true, libraryPath: DEFAULT_LIBRARY_PATH,
             destination: 'local', nasIp:'', nasShare:'', nasUser:'', nasPassword:'',
             nasFolder:'/filaflow', reportEmail: true };
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

function formatSize(bytes) {
  if (!bytes || bytes < 1024)      return bytes + ' o';
  if (bytes < 1024*1024)           return Math.round(bytes/1024) + ' Ko';
  if (bytes < 1024*1024*1024)      return (bytes/1024/1024).toFixed(1) + ' Mo';
  return (bytes/1024/1024/1024).toFixed(2) + ' Go';
}

// ── Effectuer une sauvegarde incrémentielle ───────────────
async function runBackup() {
  const settings  = await getBackupSettings();
  const dbConf    = getDbConfig();
  const startTime = Date.now();

  const now    = new Date();
  const stamp  = now.toISOString().slice(0,10) + '_' +
                 String(now.getHours()).padStart(2,'0') + '-' +
                 String(now.getMinutes()).padStart(2,'0');

  const report = {
    stamp, success: false, error: null, type: 'Incrémentielle',
    date: now.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'}),
    time: String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'),
    dbSize: 0, photoCount: 0, photoSize: 0, libCount: 0, libSize: 0,
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

    // ── Trouver la dernière sauvegarde ───────────────────
    const existing = fs.readdirSync(backupRoot)
      .filter(function(d){ return /^\d{4}-\d{2}-\d{2}_/.test(d); })
      .filter(function(d){ return fs.statSync(path.join(backupRoot,d)).isDirectory(); })
      .sort();
    const lastBackup = existing.length > 0 ? path.join(backupRoot, existing[existing.length-1]) : null;
    if (!lastBackup) report.type = 'Complète (première sauvegarde)';

    const destDir = path.join(backupRoot, stamp);
    fs.mkdirSync(destDir, { recursive: true });

    // ── 1. Base de données (toujours complète, compressée) ─
    const dbFile = path.join(destDir, 'database.sql.gz');
    await new Promise(function(resolve, reject) {
      const cmd = 'mysqldump -h' + dbConf.host + ' -u' + dbConf.user +
        ' -p' + dbConf.pass + ' --single-transaction ' + dbConf.name +
        ' | gzip > "' + dbFile + '"';
      exec(cmd, function(err){ if(err) reject(new Error(err.message)); else resolve(); });
    });
    report.dbSize = fs.statSync(dbFile).size;

    // ── 2. Photos (rsync incrémentiel avec hard links) ───
    const [[photoPathRow]] = await db.query(
      "SELECT value FROM settings WHERE key_name='prints_photo_path'"
    ).catch(function(){ return [[null]]; });
    const PHOTOS_DIR = photoPathRow?.value || '/opt/filaflow/prints';

    if (fs.existsSync(PHOTOS_DIR)) {
      const photosDest = path.join(destDir, 'photos');
      fs.mkdirSync(photosDest, { recursive: true });
      let cmd = 'rsync -a --stats';
      if (lastBackup && fs.existsSync(path.join(lastBackup, 'photos')))
        cmd += ' --link-dest="' + path.join(lastBackup, 'photos') + '"';
      cmd += ' "' + PHOTOS_DIR + '/" "' + photosDest + '/"';
      const out = await new Promise(function(resolve){
        exec(cmd, function(err, stdout){ resolve(stdout||''); });
      });
      const m = out.match(/Number of regular files transferred: (\d+)/);
      report.photoCount = m ? parseInt(m[1]) : 0;
      report.photoSize  = getDirSize(photosDest);
    }

    // ── 3. Bibliothèque (rsync incrémentiel) ─────────────
    if (settings.libraryEnabled && fs.existsSync(settings.libraryPath)) {
      const libDest = path.join(destDir, 'library');
      fs.mkdirSync(libDest, { recursive: true });
      let cmd = 'rsync -a --stats';
      if (lastBackup && fs.existsSync(path.join(lastBackup, 'library')))
        cmd += ' --link-dest="' + path.join(lastBackup, 'library') + '"';
      cmd += ' "' + settings.libraryPath + '/" "' + libDest + '/"';
      const out = await new Promise(function(resolve){
        exec(cmd, function(err, stdout){ resolve(stdout||''); });
      });
      const m = out.match(/Number of regular files transferred: (\d+)/);
      report.libCount = m ? parseInt(m[1]) : 0;
      report.libSize  = getDirSize(libDest);
    }

    // ── Manifest ────────────────────────────────────────
    fs.writeFileSync(path.join(destDir,'manifest.json'), JSON.stringify({
      stamp, date: now.toISOString(), type: report.type,
      dbSize: report.dbSize, photoCount: report.photoCount, libCount: report.libCount,
    }, null, 2));

    // Enregistrer les métadonnées en BDD pour affichage même si NAS non monté
    const metaKey = 'backup_meta_' + stamp;
    const metaVal = JSON.stringify({
      stamp, date: now.toISOString(), type: report.type,
      dbSize: report.dbSize, photoCount: report.photoCount, libCount: report.libCount,
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

  return report;
}

// ── Nettoyage des anciennes sauvegardes ───────────────────
function cleanOldBackups(backupPath, keep) {
  try {
    const files = fs.readdirSync(backupPath)
      .filter(f => f.startsWith('filaflow_') && f.endsWith('.sql'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupPath, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time); // Plus récent en premier

    const toDelete = files.slice(keep);
    toDelete.forEach(f => {
      fs.unlinkSync(path.join(backupPath, f.name));
      console.log(`[Backup] Supprimé (rétention) : ${f.name}`);
    });
  } catch (e) { console.error('[Backup] Erreur nettoyage :', e.message); }
}

// ── Sauvegarde de la bibliothèque ────────────────────────
async function backupLibrary(settings) {
  if (!fs.existsSync(settings.libraryPath)) {
    console.warn('[Backup] Bibliothèque introuvable :', settings.libraryPath);
    return;
  }
  const now      = new Date();
  const stamp    = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `filaflow_library_${stamp}.tar.gz`;
  const filepath = path.join(settings.path, filename);

  return new Promise((resolve, reject) => {
    const cmd = `tar -czf "${filepath}" -C "${path.dirname(settings.libraryPath)}" "${path.basename(settings.libraryPath)}"`;
    exec(cmd, (err) => {
      if (err) {
        console.error('[Backup] Erreur bibliothèque :', err.message);
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        reject(err);
        return;
      }
      const size = fs.statSync(filepath).size;
      console.log(`[Backup] Bibliothèque : ${filename} (${(size/1024/1024).toFixed(1)} Mo)`);
      cleanOldLibraryBackups(settings.path, settings.keep);
      resolve({ filename, filepath, size });
    });
  });
}

// ── Nettoyage anciennes sauvegardes bibliothèque ──────────
function cleanOldLibraryBackups(backupPath, keep) {
  try {
    const files = fs.readdirSync(backupPath)
      .filter(f => f.startsWith('filaflow_library_') && f.endsWith('.tar.gz'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupPath, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);
    files.slice(keep).forEach(f => {
      fs.unlinkSync(path.join(backupPath, f.name));
      console.log(`[Backup] Supprimé bibliothèque (rétention) : ${f.name}`);
    });
  } catch (e) { console.error('[Backup] Erreur nettoyage bibliothèque :', e.message); }
}

// ── Lister les sauvegardes existantes ────────────────────
function listBackups(backupPath) {
  try {
    if (!fs.existsSync(backupPath)) return [];
    return fs.readdirSync(backupPath)
      .filter(f => (f.startsWith('filaflow_') && f.endsWith('.sql')) ||
                   (f.startsWith('filaflow_library_') && f.endsWith('.tar.gz')))
      .map(f => {
        const stat = fs.statSync(path.join(backupPath, f));
        const type = f.endsWith('.tar.gz') ? 'library' : 'database';
        return { filename: f, size: stat.size, date: stat.mtime.toISOString(), type };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (_) { return []; }
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
        reportEmail: settings.reportEmail,
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

  // GET /api/backup/download/:filename — télécharger une sauvegarde
  router.get('/download/:filename', async (req, res) => {
    try {
      const settings = await getBackupSettings();
      const filename  = path.basename(req.params.filename); // sécurité
      const filepath  = path.join(settings.path, filename);
      if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Fichier non trouvé' });
      if (!filename.startsWith('filaflow_') || (!filename.endsWith('.sql') && !filename.endsWith('.tar.gz')))
        return res.status(400).json({ error: 'Fichier invalide' });
      const mime = filename.endsWith('.tar.gz') ? 'application/gzip' : 'application/sql';
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', mime);
      fs.createReadStream(filepath).pipe(res);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/backup/:filename — supprimer une sauvegarde
  router.delete('/:filename', async (req, res) => {
    try {
      const settings = await getBackupSettings();
      const filename  = path.basename(req.params.filename);
      const filepath  = path.join(settings.path, filename);
      if (!filename.startsWith('filaflow_') || (!filename.endsWith('.sql') && !filename.endsWith('.tar.gz')))
        return res.status(400).json({ error: 'Fichier invalide' });
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/backup/settings — mettre à jour et replanifier
  router.post('/settings', async (req, res) => {
    try {
      const { enabled, path: bPath, schedule, keep, libraryEnabled,
              destination, nasIp, nasShare, nasUser, nasPassword, nasFolder,
              reportEmail } = req.body;
      const entries = [
        ['backup_enabled',          String(enabled)],
        ['backup_path',             bPath       || DEFAULT_BACKUP_PATH],
        ['backup_schedule',         schedule    || DEFAULT_SCHEDULE],
        ['backup_keep',             String(parseInt(keep) || DEFAULT_KEEP)],
        ['backup_library_enabled',  String(libraryEnabled === true || libraryEnabled === 'true')],
        ['backup_destination',      destination || 'local'],
        ['backup_nas_ip',           nasIp       || ''],
        ['backup_nas_share',        nasShare    || ''],
        ['backup_nas_user',         nasUser     || ''],
        ['backup_nas_password',     nasPassword !== undefined ? encrypt(nasPassword) : undefined],
        ['backup_nas_folder',       nasFolder   || '/filaflow'],
        ['backup_report_email',     String(reportEmail !== false && reportEmail !== 'false')],
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

  // GET /api/backup/export-full — export complet BDD + bibliothèque + config en .tar.gz
  router.get('/export-full', async (req, res) => {
    const fs      = require('fs');
    const { spawn } = require('child_process');
    const settings  = await getBackupSettings();
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
      configObj._export_version = '2.9.8';
      fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(configObj, null, 2));

      // 3. Construire la commande tar en streaming direct vers HTTP
      const filename    = 'filaflow_export_' + stamp + '.tar.gz';
      const libraryPath = settings.libraryPath || '/opt/filaflow/library';

      // Construire les arguments tar
      const tarArgs = ['-czf', '-', '-C', path.dirname(tmpDir), path.basename(tmpDir)];
      if (fs.existsSync(libraryPath)) {
        tarArgs.push('-C', path.dirname(libraryPath));
        tarArgs.push(path.basename(libraryPath));
      }

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
        // Restaurer bibliotheque si presente
        var libraryRestored = false;
        var libTar = files.find(function(f) { return f.includes('library') && f.endsWith('.tar.gz'); });
        if (libTar) {
          try {
            var settings = await getBackupSettings();
            var libPath  = settings.libraryPath || DEFAULT_LIBRARY_PATH;
            await new Promise(function(resolve) {
              exec('tar -xzf "' + libTar + '" -C "' + path.dirname(libPath) + '"', function() { resolve(); });
            });
            libraryRestored = true;
          } catch(_) {}
        }
        fs.rmSync(tmpDir, { recursive: true }); fs.unlinkSync(tmpTar);
        return res.json({ ok: true, type: 'full', libraryRestored: libraryRestored,
          message: 'Restauration complete' + (libraryRestored ? ' (BDD + bibliotheque)' : ' (BDD)') });
      }
      return res.status(400).json({ error: 'Format non supporte (.sql ou .tar.gz uniquement)' });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  return router;
}

module.exports = { startBackup, setupRoutes, restartScheduler };
