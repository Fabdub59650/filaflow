// settings.js
const router = require('express').Router();
const db = require('../db');
const { logAction } = require('../history');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT key_name, value FROM settings');
    const settings = {};
    rows.forEach(r => { settings[r.key_name] = r.value; });
    // Version — lue depuis la base (mise à jour par l'updater et server.js au démarrage)
    if (!settings._version) {
      try {
        const path = require('path');
        const pkg  = require(path.join('/opt/filaflow', 'backend', 'package.json'));
        settings._version = pkg.version || '1.0.0';
      } catch(_) { settings._version = '1.0.0'; }
    }
    res.json(settings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/', async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    // Clés sensibles — ne pas loguer la valeur
    const sensitiveKeys = ['auth_password','backup_nas_password','nas_password','tigertag_webhook_token'];
    // Labels lisibles pour les clés importantes
    const keyLabels = {
      smtp_host:          'Serveur SMTP',
      smtp_user:          'Email SMTP',
      smtp_password:      'Mot de passe SMTP',
      report_email:       'Email rapport',
      auth_enabled:       'Authentification',
      auth_password:      'Mot de passe app',
      tigertag_webhook_token: 'Jeton webhook balance',
      backup_enabled:     'Sauvegarde auto',
      backup_destination: 'Destination sauvegarde',
      backup_nas_ip:      'IP NAS',
      show_prices:        'Affichage prix',
      show_locations:     'Affichage emplacements',
      theme:              'Thème couleur',
      color_mode:         'Mode clair/sombre',
    };
    const changed = [];
    for (const [k, v] of entries) {
      if (k.startsWith('_')) continue;
      if (v === undefined) continue;
      // Récupérer l'ancienne valeur pour détecter les changements
      const [[old]] = await db.query('SELECT value FROM settings WHERE key_name=?', [k]).catch(function(){ return [[null]]; });
      await db.query(
        'INSERT INTO settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
        [k, String(v), String(v)]
      );
      // Loguer seulement les clés importantes qui ont changé
      if (keyLabels[k] && old?.value !== String(v)) {
        const label = keyLabels[k];
        const val   = sensitiveKeys.includes(k) ? '(modifié)' : String(v);
        changed.push(label + ' → ' + val);
      }
    }
    if (changed.length > 0) {
      await logAction('settings', 0, 'update', 'Paramètres modifiés : ' + changed.join(', '));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// GET /api/settings/system-health — santé système Raspberry Pi
router.get('/system-health', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const result = {};

    // ── Température CPU ───────────────────────────────────────────────────
    try {
      const tempRaw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
      result.cpu_temp = Math.round(parseInt(tempRaw) / 100) / 10; // en °C
    } catch(_) {
      try {
        const t = execSync('vcgencmd measure_temp 2>/dev/null', { timeout: 2000 }).toString();
        const m = t.match(/temp=([\d.]+)/);
        result.cpu_temp = m ? parseFloat(m[1]) : null;
      } catch(_) { result.cpu_temp = null; }
    }

    // ── Mémoire RAM ───────────────────────────────────────────────────────
    try {
      const memRaw = fs.readFileSync('/proc/meminfo', 'utf8');
      const total = parseInt(memRaw.match(/MemTotal:\s+(\d+)/)?.[1] || 0) * 1024;
      const avail = parseInt(memRaw.match(/MemAvailable:\s+(\d+)/)?.[1] || 0) * 1024;
      result.mem_total = total;
      result.mem_used  = total - avail;
      result.mem_pct   = total > 0 ? Math.round((total - avail) / total * 100) : 0;
    } catch(_) { result.mem_total = null; result.mem_used = null; result.mem_pct = null; }

    // ── Espace disque (carte SD) ──────────────────────────────────────────
    try {
      const df = execSync('df -B1 / 2>/dev/null', { timeout: 3000 }).toString().split('\n')[1].split(/\s+/);
      result.disk_total = parseInt(df[1]);
      result.disk_used  = parseInt(df[2]);
      result.disk_free  = parseInt(df[3]);
      result.disk_pct   = parseInt(df[4]);
    } catch(_) { result.disk_total = null; result.disk_used = null; result.disk_free = null; result.disk_pct = null; }

    // ── Uptime ────────────────────────────────────────────────────────────
    try {
      const uptimeRaw = fs.readFileSync('/proc/uptime', 'utf8');
      result.uptime_s = Math.floor(parseFloat(uptimeRaw.split(' ')[0]));
    } catch(_) { result.uptime_s = null; }

    // ── Charge CPU ────────────────────────────────────────────────────────
    try {
      const loadRaw = fs.readFileSync('/proc/loadavg', 'utf8');
      result.load_1m  = parseFloat(loadRaw.split(' ')[0]);
      result.load_5m  = parseFloat(loadRaw.split(' ')[1]);
      result.load_15m = parseFloat(loadRaw.split(' ')[2]);
    } catch(_) { result.load_1m = null; }

    // ── Réseau IP ─────────────────────────────────────────────────────────
    try {
      const ip = execSync("hostname -I 2>/dev/null | awk '{print $1}'", { timeout: 2000 }).toString().trim();
      result.ip = ip || null;
    } catch(_) { result.ip = null; }

    // ── Statut du service FilaFlow ────────────────────────────────────────
    try {
      const status = execSync('systemctl is-active filaflow 2>/dev/null', { timeout: 2000 }).toString().trim();
      result.service_status = status;
    } catch(_) { result.service_status = 'unknown'; }

    // ── OS ────────────────────────────────────────────────────────────────
    try {
      const raw = execSync('cat /etc/os-release 2>/dev/null', { timeout: 2000 }).toString();
      const m = raw.match(/PRETTY_NAME="([^"]+)"/);
      result.os = m ? m[1] : null;
    } catch(_) { result.os = null; }

    result.node_version = process.version;
    result.timestamp    = new Date().toISOString();

    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/settings/os-info — version du système d'exploitation
router.get('/os-info', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    let os = '—';
    try {
      // Lire /etc/os-release (standard Linux)
      const raw = execSync('cat /etc/os-release 2>/dev/null', { timeout: 2000 }).toString();
      const prettyName = raw.match(/PRETTY_NAME="([^"]+)"/);
      if (prettyName) os = prettyName[1];
    } catch(_) {
      // Fallback : uname
      try { os = execSync('uname -srm', { timeout: 2000 }).toString().trim(); } catch(_) {}
    }
    // Version Node.js
    const nodeVersion = process.version;
    res.json({ os, node: nodeVersion });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
