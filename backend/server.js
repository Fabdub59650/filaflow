require('dotenv').config();
require('./logger'); // Charger en premier pour capturer toutes les erreurs
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app        = express();
const PORT       = process.env.PORT || 3000;
const nfcService    = require('./nfc');
const backupService = require('./backup');
const { authMiddleware, setupAuthRoutes } = require('./auth');
const historyService = require('./history');

app.use(cors({
  origin: function(origin, cb) {
    // Autoriser localhost (kiosque), les requêtes sans origine (curl, mobile) et le LAN
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return cb(null, true);
    }
    cb(null, true); // Autoriser tout (réseau local privé)
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static frontend (avant auth — les assets ne nécessitent pas d'auth)
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/favicon.svg', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, '../frontend/favicon.svg'));
});

// Auth routes (avant le middleware — sinon /api/auth/login serait bloqué)
const authRouter = require('express').Router();
setupAuthRoutes(authRouter);
app.use('/api/auth', authRouter);

// Auth middleware — s'applique aux routes /api/* sauf /api/auth et /api/nfc/events (SSE)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/nfc/events')) return next(); // SSE — pas d'auth
  // Localhost toujours autorisé (requêtes relayées par Nginx en local)
  const ip = req.ip || req.connection.remoteAddress || '';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
  authMiddleware(req, res, next);
});

// API routes
app.use('/api/filaments',     require('./routes/filaments'));
app.use('/api/weighings',     require('./routes/weighings'));
app.use('/api/spool-weights', require('./routes/spool-weights'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/updater',       require('./routes/updater'));
app.use('/api/logs',          require('./routes/logs'));

// TigerTag Scale webhook
const tigertagRouter = require('express').Router();
tigertagRouter.use(require('./routes/tigertag'));
app.use('/api/tigertag', tigertagRouter);

// Historique
const historyRouter = require('express').Router();
historyService.setupRoutes(historyRouter);
app.use('/api/history', historyRouter);

// NFC
const nfcRouter = require('express').Router();
nfcService.setupRoutes(nfcRouter);
app.use('/api/nfc', nfcRouter);

// Backup
const backupRouter = require('express').Router();
backupService.setupRoutes(backupRouter);
app.use('/api/backup', backupRouter);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`FilaFlow backend running on port ${PORT}`);
  // Persister la version en base pour le système de mise à jour automatique
  const db = require('./db');
  const CURRENT_VERSION = (() => {
    try { return require('./package.json').version || '1.0.0'; }
    catch(_) { return '1.0.0'; }
  })();
  db.query(
    "INSERT INTO settings (key_name,value) VALUES ('_version',?) ON DUPLICATE KEY UPDATE value=?",
    [CURRENT_VERSION, CURRENT_VERSION]
  ).catch(e => console.warn('[Version] Impossible de persister la version:', e.message));
  setTimeout(() => {
    try { nfcService.startNFC(); }
    catch(e) { console.warn('[NFC] Non disponible au démarrage:', e.message); }
  }, 3000);
  backupService.startBackup().catch(e => console.warn('[Backup] Erreur démarrage:', e.message));
});
