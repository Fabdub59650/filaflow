/**
 * weekly-report.js — Rapport hebdomadaire par e-mail
 *
 * Désactivé par défaut. Réglages (table settings, préfixe weekly_report_) :
 *   weekly_report_enabled        'true' | 'false'
 *   weekly_report_day            0 (dimanche) à 6 (samedi), défaut 1 (lundi)
 *   weekly_report_hour           0 à 23 (heure du Pi), défaut 8
 *   weekly_report_skip_empty     'true' : n'envoie que s'il y a au moins une alerte (parmi les sections d'alerte choisies)
 *   weekly_report_s_stock / _consumption / _autonomy / _low / _dormant / _fresh   'true' | 'false' (contenu)
 *   weekly_report_last_sent, weekly_report_last_status   (écrits par le planificateur)
 * L'expéditeur et le destinataire sont ceux du rapport de sauvegarde (Paramètres › Données › Rapport par email).
 */
const db = require('./db');
const mailer = require('./mailer');

const SECTIONS = [
  { key: 'stock',       label: 'Résumé du stock',                    alert: false },
  { key: 'consumption', label: 'Consommation',                       alert: false },
  { key: 'autonomy',    label: 'À racheter (autonomie courte)',      alert: true  },
  { key: 'low',         label: 'Bobines presque vides',              alert: true  },
  { key: 'dormant',     label: 'Bobines dormantes',                  alert: false },
  { key: 'fresh',       label: 'Pesées à refaire',                   alert: true  },
];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

let timer = null;

async function getConfig() {
  const [rows] = await db.query("SELECT key_name, value FROM settings WHERE key_name LIKE 'weekly\\_report\\_%'");
  const s = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
  const bool = (k, def) => (s[k] === undefined || s[k] === '' ? def : s[k] === 'true');
  const day = parseInt(s.weekly_report_day, 10), hour = parseInt(s.weekly_report_hour, 10);
  return {
    enabled: bool('weekly_report_enabled', false),
    day: Number.isInteger(day) && day >= 0 && day <= 6 ? day : 1,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8,
    skipEmpty: bool('weekly_report_skip_empty', false),
    sections: Object.fromEntries(SECTIONS.map(x => [x.key, bool('weekly_report_s_' + x.key, true)])),
    lastSent: s.weekly_report_last_sent || null,
    lastStatus: s.weekly_report_last_status || null,
  };
}

async function setSetting(k, v) {
  await db.query('INSERT INTO settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?', [k, String(v), String(v)]);
}

// Prochain déclenchement (heure locale du Pi) : le prochain « jour à heure:00 » strictement dans le futur
function nextTrigger(cfg, from) {
  const now = from ? new Date(from) : new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), cfg.hour, 0, 0, 0);
  for (let i = 0; i < 8; i++) {
    if (d.getDay() === cfg.day && d > now) return d;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// ── Mise en forme ─────────────────────────────────────────
const esc = mailer.esc;
const fmtG = n => {
  n = Math.round(n || 0);
  return n >= 10000 ? (n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' kg' : n.toLocaleString('fr-FR') + ' g';
};
const fmtEur = n => (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const fmtMonth = k => { const [y, m] = k.split('-'); return ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][+m - 1] + ' ' + y; };
function fmtDaysLeft(d, level) {
  if (level === 'rupture') return 'rupture';
  if (d < 14) return d + ' j';
  if (d < 63) return '≈ ' + Math.round(d / 7) + ' sem.';
  return '≈ ' + Math.round(d / 30.4375) + ' mois';
}
const dot = hex => '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;border:1px solid #d1d5db;background:' +
  esc(/^#[0-9a-f]{3,8}$/i.test(hex || '') ? hex : '#cccccc') + '"></span>';
const table = (head, rows) => '<table><thead><tr>' + head.map((h, i) => '<th' + (i ? ' style="text-align:right"' : '') + '>' + h + '</th>').join('') +
  '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
const tr = cells => '<tr>' + cells.map((c, i) => '<td' + (i ? ' style="text-align:right;white-space:nowrap"' : '') + '>' + c + '</td>').join('') + '</tr>';
const sec = (title, body, badge) => '<h3>' + title + (badge ? ' <span class="pill">' + badge + '</span>' : '') + '</h3>' + body;
const note = t => '<p class="muted">' + t + '</p>';

const STYLE = `
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:640px;margin:0 auto;padding:24px;background:#fff}
  h2{margin:0 0 4px;font-size:20px} h3{margin:26px 0 6px;font-size:15px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}
  .sub{color:#6b7280;font-size:13px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  th{font-size:11px;font-weight:600;color:#6b7280;text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb;text-transform:uppercase;letter-spacing:.04em}
  td{padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:13px}
  .pill{display:inline-block;font-size:11px;font-weight:600;padding:1px 9px;border-radius:10px;background:#fee2e2;color:#b91c1c;vertical-align:middle}
  .ok{background:#dcfce7;color:#15803d} .warn{background:#fef3c7;color:#92400e}
  .muted{color:#6b7280;font-size:12px;margin:6px 0}
  .kpis{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0} .kpi{flex:1 1 120px;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px}
  .kpi b{display:block;font-size:18px} .kpi span{font-size:11px;color:#6b7280}
  .footer{margin-top:28px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px}`;

/**
 * Construit le rapport d'après les sections choisies.
 * Renvoie { subject, html, alerts, alertSections } (alerts = nombre d'éléments à signaler dans les sections d'alerte choisies).
 */
async function build(cfg) {
  cfg = cfg || await getConfig();
  const { loadStats } = require('./routes/stats');
  const d = await loadStats(3);
  const st = d.stock, co = d.consumption, parts = [];
  let alerts = 0, alertSections = 0;
  const on = k => cfg.sections[k];

  if (on('stock')) {
    const kpis = [['Bobines actives', st.spools + ' (' + st.started + ' entamée' + (st.started > 1 ? 's' : '') + ')'],
      ['Filament en stock', fmtG(st.grams)], ['Valeur du stock', fmtEur(st.value)]]
      .map(k => '<div class="kpi"><b>' + esc(k[1]) + '</b><span>' + k[0] + '</span></div>').join('');
    parts.push(sec('Stock', '<div class="kpis">' + kpis + '</div>' +
      table(['Matière', 'Bobines', 'Restant', 'Valeur'],
        st.by_material.map(m => tr([esc(m.material), m.count, fmtG(m.grams), fmtEur(m.value)])))));
  }

  if (on('consumption')) {
    const m = d.monthly;
    const kpis = [['7 derniers jours', fmtG(co.last_7d_g)], ['Mois en cours (partiel)', fmtG(co.this_month_g)]]
      .map(k => '<div class="kpi"><b>' + k[1] + '</b><span>' + k[0] + '</span></div>').join('');
    parts.push(sec('Consommation estimée', '<div class="kpis">' + kpis + '</div>' +
      table(['Mois', 'Consommé'], m.months.map((k, i) => tr([fmtMonth(k), fmtG(m.total[i])]))) +
      note('Estimation d’après la baisse de poids entre deux pesées, datée du jour de la pesée.')));
  }

  if (on('autonomy')) {
    alertSections++;
    const a = d.autonomy, buy = a.to_buy;
    alerts += buy.length;
    const next = a.items.filter(x => x.level === 'ok').slice(0, 3);
    let body;
    if (!buy.length) body = '<p>Aucune couleur sous ' + a.alert_days + ' jours d’autonomie.</p>';
    else body = table(['Couleur', 'Restant', 'Conso./mois', 'Autonomie'],
      buy.map(x => tr([dot(x.color_hex) + esc(x.material + ' · ' + x.color_name), fmtG(x.grams), fmtG(x.rate_month),
        '<b style="color:' + (x.level === 'rupture' ? '#b91c1c' : '#92400e') + '">' + fmtDaysLeft(x.days_left, x.level) + '</b>'])));
    if (next.length) body += note('Ensuite : ' + next.map(x => esc(x.material + ' ' + x.color_name) + ' (' + fmtDaysLeft(x.days_left, x.level) + ')').join(', ') + '.');
    body += note('Autonomie = stock ÷ consommation moyenne sur ' + a.window_days + ' jours ; couleurs consommées de moins de ' + a.min_rate_month + ' g/mois non jugées.');
    parts.push(sec('À racheter', body, buy.length ? buy.length + ' couleur' + (buy.length > 1 ? 's' : '') : '')); 
  }

  if (on('low')) {
    alertSections++;
    const l = d.low_stock;
    if (l.threshold) {
      alerts += l.items.length;
      parts.push(sec('Bobines presque vides', l.items.length
        ? table(['Bobine', 'Restant', 'Niveau'], l.items.map(b => tr([dot(b.color_hex) + esc(b.name) + (b.spool_number ? ' <span class="muted">(' + esc(b.spool_number) + ')</span>' : ''),
            fmtG(b.weight_remaining), b.pct + ' %'])))
        : '<p>Aucune bobine sous ' + l.threshold + ' % restant.</p>', l.items.length ? String(l.items.length) : ''));
    } else {
      alertSections--;   // alerte stock désactivée dans les Paramètres : section ignorée
    }
  }

  if (on('dormant')) {
    const dm = d.dormant;
    parts.push(sec('Bobines dormantes', dm.count
      ? '<p>' + dm.count + ' bobine' + (dm.count > 1 ? 's' : '') + ' entamée' + (dm.count > 1 ? 's' : '') + ' sans baisse de poids depuis 3 mois · ' + fmtEur(dm.value) + ' immobilisés.</p>' +
        table(['Bobine', 'Restant', 'Valeur'], dm.items.slice(0, 5).map(b => tr([dot(b.color_hex) + esc(b.name) + (b.spool_number ? ' <span class="muted">(' + esc(b.spool_number) + ')</span>' : ''),
          fmtG(b.weight_remaining), fmtEur(b.value)]))) + (dm.count > 5 ? note('… et ' + (dm.count - 5) + ' autre' + (dm.count - 5 > 1 ? 's' : '') + ' (onglet Stats).') : '')
      : '<p>Aucune.</p>'));
  }

  if (on('fresh')) {
    alertSections++;
    const fr = d.freshness, n = fr.old + fr.never;
    alerts += n ? 1 : 0;
    parts.push(sec('Pesées à refaire', n
      ? '<p>' + fr.old + ' bobine' + (fr.old > 1 ? 's' : '') + ' pesée' + (fr.old > 1 ? 's' : '') + ' il y a plus de ' + fr.inventory_days + ' jours' +
        (fr.never ? ', ' + fr.never + ' jamais pesée' + (fr.never > 1 ? 's' : '') : '') + '.</p>' +
        table(['Bobine', 'Dernière pesée'], fr.items.slice(0, 10).map(b => tr([dot(b.color_hex) + esc(b.name) + (b.spool_number ? ' <span class="muted">(' + esc(b.spool_number) + ')</span>' : ''),
          b.days === null ? 'jamais' : 'il y a ' + b.days + ' j']))) + (n > 10 ? note('… et ' + (n - 10) + ' autre' + (n - 10 > 1 ? 's' : '') + ' (Outils › Inventaire).') : '')
      : '<p>Toutes les bobines ont été pesées il y a moins de ' + fr.inventory_days + ' jours.</p>', n ? String(n) : ''));
  }

  const now = new Date();
  const dateTxt = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = (alerts ? '[' + alerts + ' alerte' + (alerts > 1 ? 's' : '') + '] ' : '') + 'FilaFlow — rapport hebdomadaire du ' + dateTxt;
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + STYLE + '</style></head><body>' +
    '<h2>Rapport hebdomadaire</h2><div class="sub">' + esc(dateTxt) + (alerts ? ' · <span class="pill">' + alerts + ' à signaler</span>' : ' · <span class="pill ok">rien à signaler</span>') + '</div>' +
    (parts.length ? parts.join('') : '<p>Aucune section sélectionnée : choisissez le contenu dans Paramètres › Données › Rapport hebdomadaire.</p>') +
    '<div class="footer">FilaFlow — rapport hebdomadaire automatique, modifiable dans Paramètres › Données.</div></body></html>';
  return { subject, html, alerts, alertSections };
}

async function sendReport(cfg) {
  const smtp = await mailer.getSmtpConfig();
  const r = await build(cfg);
  await mailer.sendMail(smtp, r.subject, r.html);
  return { ...r, to: smtp.to };
}

// ── Planification ─────────────────────────────────────────
async function runScheduled() {
  try {
    const cfg = await getConfig();
    if (!cfg.enabled) return;
    const last = cfg.lastSent ? Date.parse(cfg.lastSent) : 0;
    if (Date.now() - last < 6 * 3600 * 1000) return;   // déjà envoyé à cette échéance
    const stamp = new Date().toISOString();
    const r = await build(cfg);
    if (cfg.skipEmpty && r.alertSections > 0 && r.alerts === 0) {
      await setSetting('weekly_report_last_sent', stamp);
      await setSetting('weekly_report_last_status', 'Non envoyé : rien à signaler');
      console.log('[Rapport hebdo] Rien à signaler, non envoyé');
    } else {
      const smtp = await mailer.getSmtpConfig();
      await mailer.sendMail(smtp, r.subject, r.html);
      await setSetting('weekly_report_last_sent', stamp);
      await setSetting('weekly_report_last_status', 'Envoyé à ' + smtp.to + (r.alerts ? ' (' + r.alerts + ' alerte' + (r.alerts > 1 ? 's' : '') + ')' : ''));
      console.log('[Rapport hebdo] Envoyé à', smtp.to);
    }
  } catch (e) {
    console.warn('[Rapport hebdo] Échec :', e.message);
    try { await setSetting('weekly_report_last_status', 'Échec : ' + e.message); } catch (_) {}
  }
}

async function schedule() {
  if (timer) { clearTimeout(timer); timer = null; }
  let cfg;
  try { cfg = await getConfig(); } catch (e) { return; }
  if (!cfg.enabled) return;
  const at = nextTrigger(cfg);
  const delay = Math.min(at.getTime() - Date.now(), 2 ** 31 - 1);
  console.log('[Rapport hebdo] Prochain envoi :', at.toLocaleString('fr-FR'));
  timer = setTimeout(async () => {
    await runScheduled();
    setTimeout(schedule, 60 * 1000);   // évite de redéclencher dans la même minute
  }, delay);
}

async function status() {
  const cfg = await getConfig();
  const smtp = await mailer.getSmtpConfig();
  return {
    enabled: cfg.enabled,
    next: cfg.enabled ? nextTrigger(cfg).toISOString() : null,
    last_sent: cfg.lastSent, last_status: cfg.lastStatus,
    smtp_ready: !!(smtp.host && smtp.to), to: smtp.to || '',
    day_label: DAYS[cfg.day],
  };
}

module.exports = { SECTIONS, getConfig, build, sendReport, schedule, status, nextTrigger, start: schedule };
