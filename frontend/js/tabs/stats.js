// ── Onglet Stats ────────────────────────────────────────────────────────
// Stock (poids, valeur), fraîcheur des pesées, consommation estimée, bobines dormantes.
// Tout est calculé côté serveur : backend/routes/stats.js (voir son en-tête pour les règles).
// Sous-onglets : Aperçu (indicateurs, À surveiller, graphique), Stock, Consommation (+ autonomie), Suivi (pesées, dormantes),
// Prix (historique d'achat, si la gestion des prix est activée).
// Tableaux et barres CSS ; un seul graphique (consommation mensuelle, Chart.js) avec repli en tableau.

let _statsChart = null;
let _statsPriceChart = null;
let _statsTab = 'apercu';   // sous-onglet : apercu | stock | conso | suivi
let _statsData = null;      // dernières données (changer de sous-onglet ne recharge pas)
let _statsCards = null;
try { _statsTab = localStorage.getItem('stats_tab') || 'apercu'; } catch (_) {}
const STATS_TABS = [
  { id: 'apercu', label: 'Aperçu' },
  { id: 'stock',  label: 'Stock' },
  { id: 'conso',  label: 'Consommation' },
  { id: 'suivi',  label: 'Suivi' },
  { id: 'prix',   label: 'Prix', needsPrices: true },   // masqué si « Gestion des prix » est désactivée
];
const statsTabs = function() { return STATS_TABS.filter(function(t) { return !t.needsPrices || window._showPrices !== false; }); };
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

function statsEurKg(n) {
  return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €/kg';
}
function statsTrend(t) {
  if (t === 'up')   return ' <span title="Dernier prix au-dessus de la moyenne" style="color:var(--danger)">↑</span>';
  if (t === 'down') return ' <span title="Dernier prix sous la moyenne" style="color:var(--success)">↓</span>';
  return '';
}
function statsShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? '—' : d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
}

// Courbe du prix au kilo par mois et par matière (mois sans achat : trou relié par une ligne)
function statsDrawPriceChart(m) {
  if (_statsPriceChart) { _statsPriceChart.destroy(); _statsPriceChart = null; }
  const cv = document.getElementById('stats-price-chart');
  if (!cv || typeof Chart === 'undefined') return false;
  const cs = getComputedStyle(document.documentElement);
  const tick = (cs.getPropertyValue('--text3') || '#888').trim();
  const grid = (cs.getPropertyValue('--border') || '#ddd').trim();
  _statsPriceChart = new Chart(cv, {
    type: 'line',
    data: {
      labels: m.months.map(statsMonthLabel),
      datasets: m.by_material.map(function(x, i) {
        const c = STATS_MAT_COLORS[i % STATS_MAT_COLORS.length];
        return { label: x.material, data: x.eur_kg, borderColor: c, backgroundColor: c, spanGaps: true, tension: 0.15, pointRadius: 4, borderWidth: 2 };
      }),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, color: tick, font: { size: 11 } } },
        tooltip: { callbacks: { label: function(c) { return c.dataset.label + ' : ' + statsEurKg(c.parsed.y); } } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tick, font: { size: 11 }, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: grid }, ticks: { color: tick, font: { size: 11 }, callback: function(v) { return v + ' €'; } } },
      },
    },
  });
  return true;
}

// Carte(s) de l'onglet Prix
function statsPriceCards(pr) {
  if (!pr.purchases) {
    return '<div class="card"><div class="empty-state"><p>Aucun prix renseigné : saisissez le prix de vos bobines (et leur date d’achat) pour suivre l’évolution.</p></div></div>';
  }
  const m = pr.monthly;
  const points = m.by_material.reduce(function(n, x) { return n + x.eur_kg.filter(function(v) { return v !== null; }).length; }, 0);
  const chart = (m.months.length >= 2 && points >= 2)
    ? '<div class="card"><div class="card-header"><span class="card-title">Prix au kilo par mois</span>' +
      '<span style="color:var(--text3);font-size:12px">moyenne des achats du mois, par matière</span></div>' +
      '<div style="position:relative;height:240px"><canvas id="stats-price-chart"></canvas></div>' +
      '<div id="stats-price-fallback"></div></div>'
    : '';

  const colorsByMat = {};
  pr.by_color.forEach(function(c) { (colorsByMat[c.material] = colorsByMat[c.material] || []).push(c); });
  const groups = pr.by_material.map(function(mat) {
    const list = colorsByMat[mat.material] || [];
    const rows = list.map(function(c) {
      return '<tr><td>' + statsDot(c.color_hex) + escHtml(c.color_name) + '</td>' +
        '<td' + STATS_R + '>' + c.count + '</td>' +
        '<td' + STATS_R + '>' + statsEurKg(c.last.eur_kg) + statsTrend(c.trend) + '</td>' +
        '<td' + STATS_R + '>' + statsEurKg(c.weighted) + '</td>' +
        '<td' + STATS_R + '>' + (c.count > 1 && c.min !== c.max ? statsEurKg(c.min) + ' – ' + statsEurKg(c.max) : '—') + '</td>' +
        '<td style="text-align:right;white-space:nowrap;color:var(--text3)">' + statsShortDate(c.last.date) + '</td></tr>';
    });
    return '<details class="stats-group" data-mat="prix-' + escHtml(mat.material) + '"' +
        (_statsOpenMats.has('prix-' + mat.material) ? ' open' : '') + ' ontoggle="statsToggle(this)">' +
      '<summary><span class="stats-group-name">' + escHtml(mat.material) + '</span>' +
        '<span class="stats-group-info">' + mat.count + ' achat' + (mat.count > 1 ? 's' : '') + ' · moyenne ' + statsEurKg(mat.weighted) +
        ' · dernier ' + statsEurKg(mat.last.eur_kg) + statsTrend(mat.trend) + ' · ' + statsEur(mat.spend) + ' dépensés</span></summary>' +
      statsTable([{ t: 'Couleur' }, { t: 'Achats', right: 1 }, { t: 'Dernier prix', right: 1 }, { t: 'Moyenne', right: 1 }, { t: 'Min – max', right: 1 }, { t: 'Dernier achat', right: 1 }], rows) +
    '</details>';
  }).join('');
  const byMat = '<div class="card"><div class="card-header"><span class="card-title">Prix par matière et par couleur</span>' +
    '<span style="display:flex;gap:6px"><button class="btn btn-sm" onclick="statsToggleAll(true)">Tout déplier</button>' +
    '<button class="btn btn-sm" onclick="statsToggleAll(false)">Tout replier</button></span></div>' +
    '<div class="stats-scroll">' + groups + '</div>' +
    '<div class="metric-sub" style="margin-top:10px;line-height:1.5">Prix ramenés au kilo (prix de la bobine ÷ son poids), restes de bobines exclus. ' +
      'Moyenne pondérée par les kilos achetés ; ↑ ou ↓ : dernier prix à plus de ' + pr.trend_pct + ' % de la moyenne. ' +
      (pr.without_price ? pr.without_price + ' bobine' + (pr.without_price > 1 ? 's' : '') + ' active' + (pr.without_price > 1 ? 's' : '') + ' sans prix, non comptée' + (pr.without_price > 1 ? 's' : '') + '.' : '') +
    '</div></div>';

  // Fournisseurs : seulement quand une matière a été achetée chez au moins deux fournisseurs (sinon rien à comparer)
  const supByMat = {};
  pr.suppliers.forEach(function(x) { (supByMat[x.material] = supByMat[x.material] || []).push(x); });
  const comparable = Object.keys(supByMat).filter(function(k) { return supByMat[k].length >= 2; });
  let supCard = '';
  if (comparable.length) {
    const rows = [];
    comparable.forEach(function(k) {
      const best = supByMat[k][0].weighted;
      supByMat[k].forEach(function(x, i) {
        rows.push('<tr><td>' + (i === 0 ? escHtml(k) : '') + '</td><td>' + (x.supplier ? escHtml(x.supplier) : '<span style="color:var(--text3)">non renseigné</span>') + '</td>' +
          '<td' + STATS_R + '>' + x.count + '</td><td' + STATS_R + '>' + statsEurKg(x.weighted) +
          (i === 0 ? ' <span style="color:var(--success)">✓</span>' : ' <span style="color:var(--text3)">+' + Math.round((x.weighted / best - 1) * 100) + ' %</span>') + '</td></tr>');
      });
    });
    supCard = '<div class="card"><div class="card-header"><span class="card-title">Fournisseurs</span></div>' +
      statsTable([{ t: 'Matière' }, { t: 'Fournisseur' }, { t: 'Achats', right: 1 }, { t: 'Prix moyen', right: 1 }], rows) +
      '<div class="metric-sub" style="margin-top:10px">Matières achetées chez plusieurs fournisseurs, du moins cher au plus cher.</div></div>';
  }
  return chart + byMat + supCard;
}

async function renderStats(months) {
  if (months !== undefined && months !== null) _statsMonths = String(months);

  document.getElementById('page-title').textContent = 'Stats';
  document.getElementById('topbar-actions').innerHTML =
    '<select id="stats-period" onchange="renderStats(this.value)" style="font-size:12px;margin-right:8px" title="Période pour la consommation, le graphique et les bobines dormantes">' +
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
    const shown = au.items;
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

  // ── À surveiller (Aperçu) ──────────────────────────────
  const watch = [];
  if (au && au.to_buy.length) {
    const names = au.to_buy.slice(0, 3).map(function(x) { return escHtml(x.material + ' ' + x.color_name); }).join(', ');
    watch.push({ c: 'var(--danger)', t: '<b>' + au.to_buy.length + ' couleur' + (au.to_buy.length > 1 ? 's' : '') + ' à racheter</b> : ' + names +
      (au.to_buy.length > 3 ? '…' : ''), tab: 'conso' });
  }
  if (d.low_stock && d.low_stock.threshold && d.low_stock.items.length) {
    const n = d.low_stock.items.length;
    watch.push({ c: 'var(--danger)', t: '<b>' + n + ' bobine' + (n > 1 ? 's' : '') + ' presque vide' + (n > 1 ? 's' : '') + '</b> (sous ' + d.low_stock.threshold + ' %)', tab: 'stock' });
  }
  if (fr.old + fr.never) {
    const n = fr.old + fr.never;
    watch.push({ c: 'var(--warning,#BA7517)', t: '<b>' + n + ' pesée' + (n > 1 ? 's' : '') + ' à refaire</b> (plus de ' + fr.inventory_days + ' jours' +
      (fr.never ? ', dont ' + fr.never + ' jamais pesée' + (fr.never > 1 ? 's' : '') : '') + ')', tab: 'suivi' });
  }
  if (dm.count) {
    watch.push({ c: 'var(--text3)', t: '<b>' + dm.count + ' bobine' + (dm.count > 1 ? 's' : '') + ' dormante' + (dm.count > 1 ? 's' : '') + '</b> · ' + statsEur(dm.value) + ' immobilisés', tab: 'suivi' });
  }
  const watchCard = '<div class="card"><div class="card-header"><span class="card-title">À surveiller</span></div>' +
    (watch.length ? watch.map(function(w) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border);font-size:13px">' +
        '<span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:' + w.c + '"></span>' +
        '<span style="flex:1">' + w.t + '</span>' +
        '<button class="btn btn-sm" onclick="statsSwitch(\'' + w.tab + '\')">Détail</button></div>';
    }).join('') : '<div style="color:var(--success);font-size:13px">Rien à signaler.</div>') + '</div>';

  const priceCards = (window._showPrices !== false && d.prices) ? statsPriceCards(d.prices) : '';

  _statsCards = {
    metrics: metrics, watch: watchCard, month: monthCard, auto: autoCard,
    mat: matCard, color: colorCard, cons: consCard, fresh: freshCard, dorm: dormCard, price: priceCards,
  };
  _statsData = d;
  statsShow();
}

function statsSwitch(tab) {
  _statsTab = tab;
  try { localStorage.setItem('stats_tab', tab); } catch (_) {}
  statsShow();
}

// Affiche le sous-onglet courant à partir des cartes déjà construites
function statsShow() {
  const c = _statsCards, content = document.getElementById('content');
  if (!c) return;
  if (!statsTabs().some(function(t) { return t.id === _statsTab; })) _statsTab = 'apercu';

  const bar = '<div style="display:flex;border-bottom:2px solid var(--border2);margin-bottom:20px;flex-wrap:wrap">' +
    statsTabs().map(function(t) {
      const a = t.id === _statsTab;
      return '<button onclick="statsSwitch(\'' + t.id + '\')" style="padding:8px 16px;font-size:13px;font-weight:' + (a ? '600' : '400') +
        ';border:none;cursor:pointer;background:transparent;color:' + (a ? 'var(--accent)' : 'var(--text2)') +
        ';border-bottom:' + (a ? '2px solid var(--accent)' : '2px solid transparent') + ';margin-bottom:-2px;white-space:nowrap">' + t.label + '</button>';
    }).join('') + '</div>';

  let body;
  if (_statsTab === 'stock')      body = '<div class="stats-cols"><div class="stats-col">' + c.mat + '</div><div class="stats-col">' + c.color + '</div></div>';
  else if (_statsTab === 'conso') body = c.cons + c.auto;
  else if (_statsTab === 'prix')  body = c.price;
  else if (_statsTab === 'suivi') body = '<div class="stats-cols"><div class="stats-col">' + c.fresh + '</div><div class="stats-col">' + c.dorm + '</div></div>';
  else                            body = c.watch + c.month;

  content.innerHTML = c.metrics + bar + body;

  // La période ne joue pas sur Stock ni sur Prix
  const sel = document.getElementById('stats-period');
  if (sel) sel.disabled = _statsTab === 'stock' || _statsTab === 'prix';

  const mo = _statsData.monthly;
  if (_statsTab === 'apercu' && c.month && !statsDrawChart(mo)) {
    // Chart.js indisponible (hors ligne, CDN non mis en cache) : tableau de repli
    document.getElementById('stats-monthly-chart').parentNode.style.display = 'none';
    document.getElementById('stats-monthly-fallback').innerHTML = statsTable(
      [{ t: 'Mois' }, { t: 'Consommé', right: 1 }],
      mo.months.map(function(k, i) { return '<tr><td>' + statsMonthLabel(k) + '</td><td' + STATS_R + '>' + statsG(mo.total[i]) + '</td></tr>'; }));
  } else if (_statsChart && _statsTab !== 'apercu') { _statsChart.destroy(); _statsChart = null; }

  if (_statsTab === 'prix' && document.getElementById('stats-price-chart') && !statsDrawPriceChart(_statsData.prices.monthly)) {
    document.getElementById('stats-price-chart').parentNode.style.display = 'none';
    document.getElementById('stats-price-fallback').innerHTML = '<div class="metric-sub">Graphique indisponible hors ligne : voir le tableau ci-dessous.</div>';
  } else if (_statsPriceChart && _statsTab !== 'prix') { _statsPriceChart.destroy(); _statsPriceChart = null; }
}
