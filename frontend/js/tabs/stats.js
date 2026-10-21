// ── Onglet Stats ────────────────────────────────────────────────────────
// Stock (poids, valeur), fraîcheur des pesées, consommation estimée, bobines dormantes.
// Tout est calculé côté serveur : backend/routes/stats.js (voir son en-tête pour les règles).
// Page légère : tableaux et barres CSS ; un seul graphique (consommation mensuelle, Chart.js) avec repli en tableau.

let _statsChart = null;
let _statsMonths = '6';   // période : 3 | 6 | 12 | 0 (tout)

// Groupes de couleurs dépliés (conservés d'un rafraîchissement à l'autre)
const _statsOpenMats = new Set();
function statsToggle(el) {
  if (el.open) _statsOpenMats.add(el.dataset.mat); else _statsOpenMats.delete(el.dataset.mat);
}
function statsToggleAll(open) {
  document.querySelectorAll('.stats-group').forEach(function(el) { el.open = open; });
}

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
function statsTable(head, rows, cls) {
  return '<div' + (cls ? ' class="' + cls + '"' : ' style="overflow-x:auto"') + '><table><thead><tr>' + head.map(function(h) {
    return '<th' + (h.right ? ' style="text-align:right"' : '') + '>' + h.t + '</th>';
  }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}
const STATS_R = ' style="text-align:right;white-space:nowrap"';

function statsPeriodLabel(months) {
  return months ? 'sur les ' + months + ' derniers mois' : 'depuis le début du suivi';
}


const STATS_MAT_COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#BA7517', '#7F77DD', '#D4537E', '#639922', '#888780'];
function statsMonthLabel(k) {
  const p = k.split('-');
  return ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][+p[1] - 1] + ' ' + p[0].slice(2);
}
function statsDaysLeft(d, level) {
  if (level === 'rupture') return 'rupture';
  if (d < 14) return d + ' j';
  if (d < 63) return '≈ ' + Math.round(d / 7) + ' sem.';
  return '≈ ' + Math.round(d / 30.4375) + ' mois';
}

// Graphique de consommation mensuelle (barres empilées par matière)
function statsDrawChart(m) {
  if (_statsChart) { _statsChart.destroy(); _statsChart = null; }
  const cv = document.getElementById('stats-monthly-chart');
  if (!cv || typeof Chart === 'undefined') return false;
  const cs = getComputedStyle(document.documentElement);
  const tick = (cs.getPropertyValue('--text3') || '#888').trim();
  const grid = (cs.getPropertyValue('--border') || '#ddd').trim();
  _statsChart = new Chart(cv, {
    type: 'bar',
    data: {
      labels: m.months.map(statsMonthLabel),
      datasets: m.by_material.map(function(x, i) {
        return { label: x.material, data: x.grams, backgroundColor: STATS_MAT_COLORS[i % STATS_MAT_COLORS.length], borderRadius: 2 };
      }),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, color: tick, font: { size: 11 } } },
        tooltip: { callbacks: { label: function(c) { return c.dataset.label + ' : ' + statsG(c.parsed.y); } } },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: tick, font: { size: 11 }, maxRotation: 0, autoSkip: true } },
        y: { stacked: true, beginAtZero: true, grid: { color: grid }, ticks: { color: tick, font: { size: 11 }, callback: function(v) { return statsG(v); } } },
      },
    },
  });
  return true;
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


  // ── Autonomie / à racheter ─────────────────────────────
  const au = d.autonomy;
  let autoCard = '';
  if (au && au.items.length) {
    const shown = au.items.slice(0, 12);
    autoCard = '<div class="card"><div class="card-header"><span class="card-title">Autonomie par couleur</span>' +
      (au.to_buy.length ? '<span class="badge badge-danger" style="background:var(--danger-bg,#fee2e2);color:var(--danger);padding:2px 10px;border-radius:10px;font-size:12px;font-weight:500">' +
        au.to_buy.length + ' à racheter</span>' : '<span style="color:var(--success);font-size:12px">Rien à racheter</span>') + '</div>' +
      statsTable(
        [{ t: 'Couleur' }, { t: 'Bobines', right: 1 }, { t: 'Restant', right: 1 }, { t: 'Conso./mois', right: 1 }, { t: 'Autonomie', right: 1 }],
        shown.map(function(x) {
          const col = x.level === 'rupture' ? 'var(--danger)' : x.level === 'low' ? 'var(--warning,#BA7517)' : 'var(--text2)';
          return '<tr><td>' + statsDot(x.color_hex) + escHtml(x.material + ' · ' + x.color_name) + '</td>' +
            '<td' + STATS_R + '>' + x.spools + '</td>' +
            '<td' + STATS_R + '>' + statsG(x.grams) + '</td>' +
            '<td' + STATS_R + '>' + statsG(x.rate_month) + '</td>' +
            '<td style="text-align:right;white-space:nowrap;font-weight:500;color:' + col + '">' + statsDaysLeft(x.days_left, x.level) +
              (x.level !== 'ok' ? ' ⚠' : '') + '</td></tr>';
        }), 'stats-scroll') +
      '<div class="metric-sub" style="margin-top:10px;line-height:1.5">Autonomie = stock ÷ consommation moyenne des ' + au.window_days +
        ' derniers jours. Alerte sous ' + au.alert_days + ' jours (réglable dans Paramètres › Interface). Les couleurs consommées de moins de ' +
        au.min_rate_month + ' g/mois ne sont pas jugées' + (au.items.length > shown.length ? ' · ' + (au.items.length - shown.length) + ' autres non affichées' : '') + '.</div></div>';
  }

  // ── Consommation mensuelle (graphique) ─────────────────
  const mo = d.monthly;
  let monthCard = '';
  if (mo && mo.months.length && mo.total.some(function(v) { return v > 0; })) {
    monthCard = '<div class="card"><div class="card-header"><span class="card-title">Consommation mensuelle</span>' +
      '<span style="color:var(--text3);font-size:12px">7 derniers jours : ' + statsG(co.last_7d_g) + ' · mois en cours : ' + statsG(co.this_month_g) + '</span></div>' +
      '<div style="position:relative;height:240px"><canvas id="stats-monthly-chart"></canvas></div>' +
      '<div id="stats-monthly-fallback"></div>' +
      '<div class="metric-sub" style="margin-top:8px">Mois civils, le dernier est partiel. Estimation d’après les pesées.</div></div>';
  }

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

  // ── Stock par couleur : groupes repliables par matière ─
  const colorsByMat = {};
  st.by_color.forEach(function(c) { (colorsByMat[c.material] = colorsByMat[c.material] || []).push(c); });
  const colorGroups = st.by_material.map(function(m) {
    const list = colorsByMat[m.material] || [];
    const rows = list.map(function(c) {
      return '<tr><td>' + statsDot(c.color_hex) + escHtml(c.color_name) + '</td>' +
        '<td' + STATS_R + '>' + c.count + '</td>' +
        '<td' + STATS_R + '>' + statsG(c.grams) + '</td>' +
        '<td' + STATS_R + '>' + statsEur(c.value) + '</td></tr>';
    });
    return '<details class="stats-group" data-mat="' + escHtml(m.material) + '"' +
        (_statsOpenMats.has(m.material) ? ' open' : '') + ' ontoggle="statsToggle(this)">' +
      '<summary><span class="stats-group-name">' + escHtml(m.material) + '</span>' +
        '<span class="stats-group-info">' + list.length + ' couleur' + (list.length > 1 ? 's' : '') +
        ' · ' + statsG(m.grams) + ' · ' + statsEur(m.value) + '</span></summary>' +
      statsTable([{ t: 'Couleur' }, { t: 'Bobines', right: 1 }, { t: 'Restant', right: 1 }, { t: 'Valeur', right: 1 }], rows) +
    '</details>';
  }).join('');
  const colorCard = '<div class="card"><div class="card-header"><span class="card-title">Stock par couleur</span>' +
    '<span style="display:flex;gap:6px">' +
      '<button class="btn btn-sm" onclick="statsToggleAll(true)">Tout déplier</button>' +
      '<button class="btn btn-sm" onclick="statsToggleAll(false)">Tout replier</button></span></div>' +
    '<div class="stats-scroll">' + colorGroups + '</div></div>';

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
    dormBody = '<div style="color:var(--text3);font-size:13px">Aucune : toutes les bobines entamées ont une baisse de poids mesurée ' + statsPeriodLabel(months_) + '.</div>';
  } else {
    dormBody =
      '<div class="metric-sub" style="margin:-6px 0 10px">' + dm.count + ' bobine' + (dm.count > 1 ? 's' : '') +
        ' · ' + statsEur(dm.value) + ' immobilisés' + '</div>' +
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
        }), 'stats-scroll');
  }
  const dormCard = '<div class="card"><div class="card-header"><span class="card-title">Bobines dormantes</span></div>' + dormBody +
    '<div class="metric-sub" style="margin-top:10px;line-height:1.5">Bobines entamées (hors bobines neuves) sans baisse de poids mesurée ' +
      statsPeriodLabel(months_) + '. Une bobine peu pesée peut apparaître ici alors qu’elle sert : une pesée récente la fait sortir de la liste.</div></div>';

  content.innerHTML = metrics + autoCard + monthCard +
    '<div class="stats-cols">' +
      '<div class="stats-col">' + matCard + consCard + freshCard + '</div>' +
      '<div class="stats-col">' + colorCard + dormCard + '</div>' +
    '</div>';

  if (monthCard && !statsDrawChart(mo)) {
    // Chart.js indisponible (hors ligne, CDN non mis en cache) : tableau de repli
    document.getElementById('stats-monthly-chart').parentNode.style.display = 'none';
    document.getElementById('stats-monthly-fallback').innerHTML = statsTable(
      [{ t: 'Mois' }, { t: 'Consommé', right: 1 }],
      mo.months.map(function(k, i) { return '<tr><td>' + statsMonthLabel(k) + '</td><td' + STATS_R + '>' + statsG(mo.total[i]) + '</td></tr>'; }));
  }
}
