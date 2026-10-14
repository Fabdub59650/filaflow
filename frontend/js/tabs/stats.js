// ── Onglet Stats ────────────────────────────────────────────────────────
// Stock (poids, valeur), fraîcheur des pesées, consommation estimée, bobines dormantes.
// Tout est calculé côté serveur : backend/routes/stats.js (voir son en-tête pour les règles).
// Page volontairement légère : tableaux et barres CSS, pas de graphique.

let _statsMonths = '6';   // période : 3 | 6 | 12 | 0 (tout)

const STATS_PERIODS = [
  { v: '3',  label: '3 mois' },
  { v: '6',  label: '6 mois' },
  { v: '12', label: '12 mois' },
  { v: '0',  label: 'Tout' },
];

function statsG(n) {
  n = Math.round(n || 0);
  return n >= 10000 ? (n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' kg'
                    : n.toLocaleString('fr-FR') + ' g';
}
function statsEur(n) {
  return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function statsBar(pct, color) {
  const w = Math.max(0, Math.min(100, pct || 0));
  return '<div style="height:6px;background:var(--bg3);border-radius:3px;min-width:60px">' +
    '<div style="width:' + w + '%;height:100%;border-radius:3px;background:' + (color || 'var(--accent)') + '"></div></div>';
}
function statsDot(hex) {
  return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;' +
    'vertical-align:middle;border:0.5px solid var(--border2);background:' + escHtml(hex || '#cccccc') + '"></span>';
}
function statsMetric(label, value, sub) {
  return '<div class="metric-card"><div class="metric-label">' + label + '</div>' +
    '<div class="metric-value">' + value + '</div>' +
    (sub ? '<div class="metric-sub">' + sub + '</div>' : '') + '</div>';
}
function statsTable(head, rows) {
  return '<div style="overflow-x:auto"><table><thead><tr>' + head.map(function(h) {
    return '<th' + (h.right ? ' style="text-align:right"' : '') + '>' + h.t + '</th>';
  }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}
const STATS_R = ' style="text-align:right;white-space:nowrap"';

function statsPeriodLabel(months) {
  return months ? 'sur les ' + months + ' derniers mois' : 'depuis le début du suivi';
}

async function renderStats(months) {
  if (months !== undefined && months !== null) _statsMonths = String(months);

  document.getElementById('page-title').textContent = 'Stats';
  document.getElementById('topbar-actions').innerHTML =
    '<select id="stats-period" onchange="renderStats(this.value)" style="font-size:12px;margin-right:8px" title="Période pour la consommation et les bobines dormantes">' +
      STATS_PERIODS.map(function(p) {
        return '<option value="' + p.v + '"' + (p.v === _statsMonths ? ' selected' : '') + '>' + p.label + '</option>';
      }).join('') +
    '</select>' +
    '<button class="btn btn-sm" onclick="renderStats()">↺ Actualiser</button>';

  const content = document.getElementById('content');
  content.innerHTML = '<div style="color:var(--text3);padding:20px 0">Chargement…</div>';

  let d;
  try {
    d = await API.get('/stats?months=' + encodeURIComponent(_statsMonths));
  } catch (e) {
    content.innerHTML = '<div style="color:var(--danger);padding:20px 0">' + escHtml(e.message) + '</div>';
    return;
  }

  const st = d.stock, co = d.consumption, fr = d.freshness, dm = d.dormant;
  const months_ = d.period.months;

  if (!st.spools) {
    content.innerHTML = '<div class="empty-state"><p>Aucune bobine active : les statistiques apparaîtront dès que le stock sera renseigné.</p></div>';
    return;
  }

  // ── Indicateurs ────────────────────────────────────────
  const metrics = '<div class="metrics-grid">' +
    statsMetric('Bobines actives', st.spools, st.started + ' entamée' + (st.started > 1 ? 's' : '')) +
    statsMetric('Filament en stock', statsG(st.grams)) +
    statsMetric('Valeur du stock', statsEur(st.value),
      st.without_price ? st.without_price + ' bobine' + (st.without_price > 1 ? 's' : '') + ' sans prix' : '') +
    statsMetric('Consommation estimée', statsG(co.grams), statsPeriodLabel(months_)) +
  '</div>';

  // ── Stock par matière ──────────────────────────────────
  const maxMat = Math.max.apply(null, st.by_material.map(function(m) { return m.grams; }).concat([1]));
  const matCard = '<div class="card"><div class="card-header"><span class="card-title">Stock par matière</span></div>' +
    statsTable(
      [{ t: 'Matière' }, { t: 'Bobines', right: 1 }, { t: 'Entamées', right: 1 }, { t: 'Restant', right: 1 }, { t: 'Valeur', right: 1 }, { t: '' }],
      st.by_material.map(function(m) {
        return '<tr><td>' + escHtml(m.material) + '</td>' +
          '<td' + STATS_R + '>' + m.count + '</td>' +
          '<td' + STATS_R + '>' + m.started + '</td>' +
          '<td' + STATS_R + '>' + statsG(m.grams) + '</td>' +
          '<td' + STATS_R + '>' + statsEur(m.value) + '</td>' +
          '<td style="width:22%">' + statsBar(m.grams / maxMat * 100) + '</td></tr>';
      })) +
  '</div>';

  // ── Stock par couleur (regroupé par matière) ───────────
  let lastMat = null;
  const colorRows = [];
  st.by_color.forEach(function(c) {
    if (c.material !== lastMat) {
      lastMat = c.material;
      colorRows.push('<tr><td colspan="4" style="padding-top:12px;font-weight:500;color:var(--text2)">' + escHtml(c.material) + '</td></tr>');
    }
    colorRows.push('<tr><td>' + statsDot(c.color_hex) + escHtml(c.color_name) + '</td>' +
      '<td' + STATS_R + '>' + c.count + '</td>' +
      '<td' + STATS_R + '>' + statsG(c.grams) + '</td>' +
      '<td' + STATS_R + '>' + statsEur(c.value) + '</td></tr>');
  });
  const colorCard = '<div class="card"><div class="card-header"><span class="card-title">Stock par couleur</span></div>' +
    statsTable([{ t: 'Couleur' }, { t: 'Bobines', right: 1 }, { t: 'Restant', right: 1 }, { t: 'Valeur', right: 1 }], colorRows) +
  '</div>';

  // ── Consommation estimée ───────────────────────────────
  let consBody;
  if (!co.grams) {
    consBody = '<div style="color:var(--text3);font-size:13px">Aucune consommation mesurée ' + statsPeriodLabel(months_) + '.</div>';
  } else {
    const maxCons = Math.max.apply(null, co.by_material.map(function(m) { return m.grams; }).concat([1]));
    consBody =
      '<div style="margin-bottom:12px"><span style="font-size:20px;font-weight:500">' + statsG(co.grams) + '</span>' +
        '<span style="color:var(--text2);margin-left:10px">' + (co.cost ? '≈ ' + statsEur(co.cost) : '') + '</span>' +
        (co.grams_without_price ? '<div class="metric-sub">' + statsG(co.grams_without_price) + ' sur des bobines sans prix, non valorisés</div>' : '') +
      '</div>' +
      statsTable(
        [{ t: 'Matière' }, { t: 'Consommé', right: 1 }, { t: 'Coût estimé', right: 1 }, { t: '' }],
        co.by_material.map(function(m) {
          return '<tr><td>' + escHtml(m.material) + '</td>' +
            '<td' + STATS_R + '>' + statsG(m.grams) + '</td>' +
            '<td' + STATS_R + '>' + (m.cost ? statsEur(m.cost) : '—') + '</td>' +
            '<td style="width:30%">' + statsBar(m.grams / maxCons * 100) + '</td></tr>';
        }));
  }
  const consCard = '<div class="card"><div class="card-header"><span class="card-title">Consommation estimée</span></div>' +
    consBody +
    '<div class="metric-sub" style="margin-top:12px;line-height:1.5">' +
      'Estimation d’après la baisse de poids entre deux pesées, datée du jour de la pesée : elle est d’autant moins précise que les pesées sont espacées. ' +
      'Ignorées sur la période : ' + co.ignored_first + ' première' + (co.ignored_first > 1 ? 's' : '') + ' pesée' + (co.ignored_first > 1 ? 's' : '') +
      ' (poids théorique de départ) et ' + co.ignored_rises + ' pesée' + (co.ignored_rises > 1 ? 's' : '') + ' où le poids remonte.' +
    '</div></div>';

  // ── Fraîcheur des pesées ───────────────────────────────
  const frRows = [
    { label: 'Moins de 30 jours',                  n: fr.recent, color: 'var(--success)' },
    { label: '30 à ' + fr.inventory_days + ' jours', n: fr.mid,    color: 'var(--accent)' },
    { label: 'Plus de ' + fr.inventory_days + ' jours', n: fr.old, color: 'var(--danger)' },
    { label: 'Jamais pesées',                      n: fr.never,  color: 'var(--text3)' },
  ];
  const freshCard = '<div class="card"><div class="card-header"><span class="card-title">Fraîcheur des pesées</span></div>' +
    frRows.map(function(r) {
      return '<div style="display:grid;grid-template-columns:minmax(120px,200px) 1fr 40px;gap:12px;align-items:center;margin-bottom:8px">' +
        '<span style="font-size:13px">' + r.label + '</span>' + statsBar(r.n / st.spools * 100, r.color) +
        '<span style="text-align:right;font-size:13px">' + r.n + '</span></div>';
    }).join('') +
    '<div class="metric-sub">Âge de la dernière pesée ou de la dernière validation d’inventaire, sur les bobines actives.</div></div>';

  // ── Bobines dormantes ──────────────────────────────────
  let dormBody;
  if (!dm.count) {
    dormBody = '<div style="color:var(--text3);font-size:13px">Aucune : toutes les bobines entamées ou en stock ont une baisse de poids mesurée ' + statsPeriodLabel(months_) + '.</div>';
  } else {
    dormBody =
      '<div class="metric-sub" style="margin:-6px 0 10px">' + dm.count + ' bobine' + (dm.count > 1 ? 's' : '') +
        ' · ' + statsEur(dm.value) + ' immobilisés' + (dm.count > dm.items.length ? ' · les ' + dm.items.length + ' plus chères sont listées' : '') + '</div>' +
      statsTable(
        [{ t: 'Bobine' }, { t: 'Couleur' }, { t: 'Restant', right: 1 }, { t: 'Valeur', right: 1 }, { t: 'Dernière baisse', right: 1 }],
        dm.items.map(function(b) {
          return '<tr><td>' + escHtml(b.name) +
              (b.spool_number ? ' <span style="color:var(--text3)">(' + escHtml(b.spool_number) + ')</span>' : '') + '</td>' +
            '<td>' + statsDot(b.color_hex) + escHtml((b.material || '') + (b.color_name ? ' · ' + b.color_name : '')) + '</td>' +
            '<td' + STATS_R + '>' + statsG(b.weight_remaining) + '</td>' +
            '<td' + STATS_R + '>' + statsEur(b.value) + '</td>' +
            '<td style="text-align:right;white-space:nowrap;color:var(--text3)">' +
              (b.last_use_at ? fmtDate(b.last_use_at) : 'aucune mesurée') + '</td></tr>';
        }));
  }
  const dormCard = '<div class="card"><div class="card-header"><span class="card-title">Bobines dormantes</span></div>' + dormBody +
    '<div class="metric-sub" style="margin-top:10px;line-height:1.5">Bobines avec du filament restant et sans baisse de poids mesurée ' +
      statsPeriodLabel(months_) + '. Une bobine peu pesée peut apparaître ici alors qu’elle sert : une pesée récente la fait sortir de la liste.</div></div>';

  content.innerHTML = metrics + '<div class="stats-grid">' + matCard + colorCard + '</div>' +
    consCard + '<div class="stats-grid">' + freshCard + dormCard + '</div>';
}
