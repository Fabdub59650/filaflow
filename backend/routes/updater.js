/**
 * updater.js — Mise à jour automatique depuis GitHub
 */

const router  = require('express').Router();
const db      = require('../db');
const path    = require('path');
const fs      = require('fs');
const { execSync, exec } = require('child_process');

const GITHUB_REPO    = 'Fabdub59650/filaflow';
const GITHUB_API     = 'https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest';
const INSTALL_DIR    = '/opt/filaflow';
const UPDATE_WORK    = '/tmp/filaflow-update';

// ── GET /api/updater/check — vérifier si une mise à jour est disponible ───
router.get('/check', async (req, res) => {
  try {
    const nodeFetch = require('node-fetch');

    // Version installée — depuis settings ou package.json
    const [[vRow]] = await db.query(
      "SELECT value FROM settings WHERE key_name='_version'"
    ).catch(function(){ return [[null]]; });
    let currentVersion = vRow?.value || null;
    if (!currentVersion || currentVersion === '0.0.0') {
      try {
        const pkg = require(path.join(INSTALL_DIR, 'backend', 'package.json'));
        currentVersion = pkg.version || '0.0.0';
      } catch(_) { currentVersion = '0.0.0'; }
    }

    // Interroger GitHub
    const ghRes = await nodeFetch(GITHUB_API, {
      headers: { 'User-Agent': 'FilaFlow-Updater' },
      timeout: 10000,
    });
    if (!ghRes.ok) throw new Error('GitHub API : ' + ghRes.status);
    const release = await ghRes.json();

    const latestVersion = release.tag_name.replace(/^[vV]\.?/, '');
    const isNewer = compareVersions(latestVersion, currentVersion) > 0;

    res.json({
      current_version: currentVersion,
      latest_version:  latestVersion,
      is_newer:        isNewer,
      release_name:    release.name || latestVersion,
      release_notes:   release.body || '',
      published_at:    release.published_at,
      download_url:    release.assets?.find(function(a){ return a.name.endsWith('.zip'); })?.browser_download_url
                       || release.zipball_url,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/updater/update — lancer la mise à jour ─────────────────────
router.post('/update', async (req, res) => {
  try {
    const { download_url, latest_version } = req.body;
    if (!download_url) return res.status(400).json({ error: 'URL de téléchargement manquante' });

    // Répondre immédiatement — la mise à jour se fait en arrière-plan
    res.json({ ok: true, message: 'Mise à jour en cours — FilaFlow va redémarrer dans quelques secondes.' });

    // Lancer en arrière-plan
    setTimeout(function() {
      runUpdate(download_url, latest_version).catch(function(e) {
        console.error('[Updater] Erreur :', e.message);
      });
    }, 500);

  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Fonction de mise à jour ───────────────────────────────────────────────
async function runUpdate(downloadUrl, version) {
  const nodeFetch = require('node-fetch');
  console.log('[Updater] Début mise à jour v' + version);

  // 1. Créer dossier de travail
  if (fs.existsSync(UPDATE_WORK)) execSync('rm -rf ' + UPDATE_WORK);
  fs.mkdirSync(UPDATE_WORK, { recursive: true });

  // 2. Télécharger le ZIP
  console.log('[Updater] Téléchargement depuis', downloadUrl);
  const zipPath = path.join(UPDATE_WORK, 'update.zip');
  const response = await nodeFetch(downloadUrl, {
    headers: { 'User-Agent': 'FilaFlow-Updater' }
  });
  if (!response.ok) throw new Error('Téléchargement échoué : ' + response.status);
  const buffer = await response.buffer();
  fs.writeFileSync(zipPath, buffer);
  console.log('[Updater] ZIP téléchargé :', Math.round(buffer.length / 1024) + ' Ko');

  // 3. Extraire
  const extractDir = path.join(UPDATE_WORK, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });
  execSync('unzip -q "' + zipPath + '" -d "' + extractDir + '"', { timeout: 60000 });

  // Trouver le dossier racine dans le ZIP
  const entries = fs.readdirSync(extractDir);
  const rootDir = entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()
    ? path.join(extractDir, entries[0])
    : extractDir;
  console.log('[Updater] Extrait dans', rootDir);

  // 4. Fichiers à NE PAS écraser (données utilisateur)
  const EXCLUDE = [
    'backend/.key',
    'backend/.env',
    'backend/node_modules',
    'frontend/uploads',
    'backups',
    '*.crt', '*.pem', '*.key',
  ];

  // 5. Copier les fichiers (rsync)
  const excludeArgs = EXCLUDE.map(function(e){ return '--exclude="' + e + '"'; }).join(' ');
  const rsyncCmd = 'rsync -a ' + excludeArgs + ' "' + rootDir + '/" "' + INSTALL_DIR + '/"';
  console.log('[Updater] Copie des fichiers...');
  execSync(rsyncCmd, { timeout: 120000 });

  // 6. Mettre à jour les dépendances npm si package.json a changé
  const pkgPath = path.join(INSTALL_DIR, 'backend', 'package.json');
  if (fs.existsSync(pkgPath)) {
    console.log('[Updater] npm install...');
    execSync('cd "' + INSTALL_DIR + '/backend" && npm install --production --quiet', {
      timeout: 120000
    });
  }

  // 7. Mettre à jour la version en base
  try {
    await db.query(
      "INSERT INTO settings (key_name, value) VALUES ('_version', ?) ON DUPLICATE KEY UPDATE value=?",
      [version, version]
    );
    console.log('[Updater] Version mise à jour en base :', version);
  } catch(e) {
    console.error('[Updater] Impossible de mettre à jour la version en base :', e.message);
  }

  // 8. Nettoyage
  execSync('rm -rf ' + UPDATE_WORK);
  console.log('[Updater] Mise à jour v' + version + ' installée — redémarrage...');

  // 9. Redémarrer le service
  setTimeout(function() {
    exec('systemctl restart filaflow', function(err) {
      if (err) console.error('[Updater] Erreur redémarrage :', err.message);
    });
  }, 1000);
}

// ── Comparaison de versions (semver simplifié) ────────────────────────────
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

module.exports = router;
