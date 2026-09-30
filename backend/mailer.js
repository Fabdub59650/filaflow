/**
 * mailer.js — Envoi du rapport de sauvegarde par email (SMTP via nodemailer)
 *
 * Réglages (table settings) : smtp_host, smtp_port, smtp_secure, smtp_user,
 * smtp_password (chiffré AES-256-GCM), smtp_from, report_email (destinataire).
 */

const db = require('./db');
const { decrypt } = require('./crypto');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) {}

// ── Configuration SMTP ────────────────────────────────────
async function getSmtpConfig() {
  const [rows] = await db.query(
    "SELECT key_name, value FROM settings WHERE key_name LIKE 'smtp\\_%' OR key_name = 'report_email'"
  );
  const s = {};
  rows.forEach(function(r) { s[r.key_name] = r.value; });
  let password = '';
  if (s.smtp_password) { try { password = decrypt(s.smtp_password); } catch (_) { password = ''; } }
  return {
    host:     s.smtp_host   || '',
    port:     parseInt(s.smtp_port) || 587,
    secure:   s.smtp_secure === 'true',
    user:     s.smtp_user   || '',
    password: password,
    from:     s.smtp_from   || s.smtp_user || '',
    to:       s.report_email || '',
  };
}

// ── Envoi générique ───────────────────────────────────────
async function sendMail(cfg, subject, html) {
  if (!nodemailer) throw new Error('nodemailer non installé');
  if (!cfg.host)   throw new Error('Serveur SMTP non renseigné');
  if (!cfg.to)     throw new Error('Adresse destinataire non renseignée');
  const transporter = nodemailer.createTransport({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.secure,           // true = SSL direct (465) ; false = STARTTLS (587)
    auth:   cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 15000,
  });
  await transporter.sendMail({ from: cfg.from || cfg.user, to: cfg.to, subject: subject, html: html });
}

// ── Mise en forme ─────────────────────────────────────────
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatSize(bytes) {
  if (!bytes)                 return '—';
  if (bytes < 1024)           return bytes + ' o';
  if (bytes < 1024*1024)      return Math.round(bytes/1024) + ' Ko';
  if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(1) + ' Mo';
  return (bytes/1024/1024/1024).toFixed(2) + ' Go';
}

const STYLE = `
  body{font-family:system-ui,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px}
  .badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:16px}
  .ok h2{color:#16a34a;margin-bottom:4px} .ok .badge{background:#dcfce7;color:#16a34a}
  .ko h2{color:#dc2626;margin-bottom:4px} .ko .badge{background:#fee2e2;color:#dc2626}
  table{width:100%;border-collapse:collapse;margin:12px 0}
  td{padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px}
  td:first-child{color:#6b7280;width:45%} td:last-child{font-weight:500}
  .err{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px;
       font-family:monospace;font-size:13px;color:#991b1b;margin:16px 0}
  .footer{margin-top:24px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px}`;

function page(cls, body) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + STYLE + '</style></head>' +
         '<body class="' + cls + '">' + body +
         '<div class="footer">FilaFlow — Rapport de sauvegarde automatique</div></body></html>';
}

// ── Rapport de sauvegarde ─────────────────────────────────
async function sendBackupReport(report) {
  const cfg = await getSmtpConfig();
  const dmin = Math.floor((report.duration || 0) / 60), dsec = (report.duration || 0) % 60;
  const dur  = dmin > 0 ? dmin + ' min ' + dsec + ' s' : dsec + ' s';
  const when = report.date + ' à ' + report.time;

  const tag = !report.success ? '[ERREUR] ' : (report.systemError ? '[OK, config système manquante] ' : '[OK] ');
  const subject = tag + 'Sauvegarde FilaFlow — ' + report.date + ' ' + report.time;
  const html = report.success
    ? page('ok',
        '<h2>Sauvegarde réussie</h2><span class="badge">OK</span><table>' +
        '<tr><td>Date</td><td>' + esc(when) + '</td></tr>' +
        '<tr><td>Durée</td><td>' + dur + '</td></tr>' +
        '<tr><td>Destination</td><td>' + esc(report.destination) + '</td></tr>' +
        '<tr><td>Base de données</td><td>' + formatSize(report.dbSize) + '</td></tr>' +
        '<tr><td>Configuration système</td><td>' +
          (report.systemError ? '<span style="color:#dc2626">non sauvegardée</span>' : formatSize(report.systemSize)) + '</td></tr>' +
        '<tr><td>Espace total utilisé</td><td>' + formatSize(report.totalSize) + '</td></tr>' +
        (report.deleted && report.deleted.length
          ? '<tr><td>Supprimées (rétention)</td><td>' + report.deleted.map(esc).join('<br>') + '</td></tr>' : '') +
        '</table>' +
        (report.systemError ? '<div class="err">Configuration système : ' + esc(report.systemError) + '</div>' : ''))
    : page('ko',
        '<h2>Échec de la sauvegarde</h2><span class="badge">ERREUR</span>' +
        '<p style="color:#6b7280;font-size:13px">Sauvegarde du ' + esc(when) +
        (report.destination ? ' vers ' + esc(report.destination) : '') + '</p>' +
        '<div class="err">' + esc(report.error) + '</div>');

  await sendMail(cfg, subject, html);
  console.log('[Mailer] Rapport de sauvegarde envoyé à', cfg.to);
}

// ── Mail de test (valeurs du formulaire, mot de passe enregistré si vide) ──
async function sendTestMail(override) {
  const saved = await getSmtpConfig();
  const cfg = {
    host:     override.smtpHost   || saved.host,
    port:     parseInt(override.smtpPort) || saved.port,
    secure:   override.smtpSecure !== undefined ? (override.smtpSecure === true || override.smtpSecure === 'true') : saved.secure,
    user:     override.smtpUser   || saved.user,
    password: override.smtpPassword || saved.password,
    from:     override.smtpFrom   || saved.from,
    to:       override.reportTo   || saved.to,
  };
  await sendMail(cfg, 'Test FilaFlow — envoi d\'email',
    page('ok', '<h2>Configuration email opérationnelle</h2><span class="badge">TEST</span>' +
      '<p style="font-size:13px">Les rapports de sauvegarde de FilaFlow seront envoyés à cette adresse.</p>'));
  return cfg.to;
}

module.exports = { getSmtpConfig, sendBackupReport, sendTestMail };
