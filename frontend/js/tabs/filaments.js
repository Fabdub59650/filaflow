let allFilaments  = [];
let showArchived  = false;
let _sortCol      = null;
let _sortDir      = 'asc';
let _filterQuery  = '';
let _filterMat    = '';
let _filterColor  = '';   // clé normalisée de « Nom couleur »
let _filView      = (function(){ try { return localStorage.getItem('ff_fil_view') || 'grid'; } catch(_) { return 'grid'; } })();

// Filtres avancés filaments
let _filAdvanced = {
  finish:     '',
  special:    '',
  diameter:   '',
  location:   '',
  nfc:        '',   // 'with' | 'without' | ''
  stock_min:  '',
  stock_max:  '',
  pct_max:    '',   // filtre "stock faible" %
};
let _filAdvancedOpen = false;

// ── Colonnes configurables ────────────────────────────────
const FILAMENT_COLS = [
  { id: 'nom',         label: 'Nom',           always: true,  flex: 3   },
  { id: 'couleur',     label: 'Couleur',       always: false, flex: 1.2 },
  { id: 'option',      label: 'Option',        always: false, flex: 1.5 },
  { id: 'finition',    label: 'Finition',      always: false, flex: 1.2 },
  { id: 'marque',      label: 'Marque',        always: false, flex: 1.5 },
  { id: 'spool_num',   label: 'N° bobine',     always: false, flex: 1   },
  { id: 'stock',       label: 'Stock restant', always: true,  flex: 1.8 },
  { id: 'longueur',    label: 'Longueur',      always: false, flex: 1.2 },
  { id: 'progress',    label: 'Progression',   always: false, flex: 2   },
  { id: 'bobine',      label: 'Bobine vide',   always: false, flex: 1   },
  { id: 'prix',        label: 'Prix',          always: false, flex: 0.8, setting: 'prices'    },
  { id: 'emplacement', label: 'Emplacement',   always: false, flex: 1.5, setting: 'locations' },
];

// Calcule les largeurs % en fonction des colonnes visibles (en laissant 170px pour les actions)
function computeColWidths(visCols) {
  const total = visCols.reduce(function(s, col) { return s + col.flex; }, 0);
  return visCols.map(function(col) {
    return 'calc((100% - 200px) * ' + (col.flex / total) + ')';
  });
}

function sortFilaments(filaments) {
  if (!_sortCol) return filaments;
  return [...filaments].sort(function(a, b) {
    let va = _sortCol === 'pct' ? (a.weight_total > 0 ? a.weight_remaining / a.weight_total : 0) : (a[_sortCol] || '');
    let vb = _sortCol === 'pct' ? (b.weight_total > 0 ? b.weight_remaining / b.weight_total : 0) : (b[_sortCol] || '');
    if (typeof va === 'number' || !isNaN(va)) { va = parseFloat(va)||0; vb = parseFloat(vb)||0; }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    if (va < vb) return _sortDir === 'asc' ? -1 : 1;
    if (va > vb) return _sortDir === 'asc' ?  1 : -1;
    return 0;
  });
}

function filterFilaments(filaments) {
  let result = filaments;

  // Filtres rapides
  if (_filterMat) result = result.filter(function(f){ return f.material === _filterMat; });
  if (_filterColor) result = result.filter(function(f){ return colorKey(f) === _filterColor; });
  if (_filterQuery) {
    const q = _filterQuery.toLowerCase();
    result = result.filter(function(f) {
      return (f.name       && f.name.toLowerCase().includes(q)) ||
             (f.brand      && f.brand.toLowerCase().includes(q)) ||
             (f.material   && f.material.toLowerCase().includes(q)) ||
             (f.color_name && f.color_name.toLowerCase().includes(q)) ||
             (f.spool_number && f.spool_number.toLowerCase().includes(q)) ||
             (f.notes      && f.notes.toLowerCase().includes(q));
    });
  }

  // Filtres avancés
  const A = _filAdvanced;
  if (A.finish)   result = result.filter(function(f) { return f.finish_option === A.finish; });
  if (A.special)  result = result.filter(function(f) { return f.special_option === A.special; });
  if (A.diameter) result = result.filter(function(f) { return String(f.diameter) === A.diameter; });
  if (A.location) {
    const lq = A.location.toLowerCase();
    result = result.filter(function(f) { return f.location && f.location.toLowerCase().includes(lq); });
  }
  if (A.nfc === 'with')    result = result.filter(function(f) { return !!f.nfc_uid; });
  if (A.nfc === 'without') result = result.filter(function(f) { return !f.nfc_uid; });
  if (A.stock_min !== '') result = result.filter(function(f) { return parseFloat(f.weight_remaining||0) >= parseFloat(A.stock_min); });
  if (A.stock_max !== '') result = result.filter(function(f) { return parseFloat(f.weight_remaining||0) <= parseFloat(A.stock_max); });
  if (A.pct_max !== '') {
    const maxPct = parseFloat(A.pct_max);
    result = result.filter(function(f) {
      const p = f.weight_total > 0 ? (f.weight_remaining / f.weight_total * 100) : 0;
      return p <= maxPct;
    });
  }

  return result;
}

function countActiveFilAdvanced() {
  return Object.values(_filAdvanced).filter(function(v) { return v !== ''; }).length;
}

// ── Regroupement par matière ou par « Nom couleur » ──────────────────────
function colorKey(f) {
  return (f.color_name || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function colorLabel(f) {
  const c = (f.color_name || '').trim();
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Sans couleur';
}
function getFilGroup() {
  const def = _filView === 'list' ? 'material' : 'none';
  try { return localStorage.getItem('ff_fil_group_' + _filView) || def; } catch(_) { return def; }
}
function setFilGroup(v) {
  try { localStorage.setItem('ff_fil_group_' + _filView, v); } catch(_) {}
  renderFilamentGrid();
}
function setColorFilter(key) {
  _filterColor = _filterColor === key ? '' : key;
  renderFilamentGrid();
}
// Découpe la liste ordonnée en groupes [{ key, label, items }]
function buildFilGroups(list, mode) {
  if (mode === 'none') return [{ key: '', label: 'Toutes les bobines', items: list }];
  const map = new Map();
  list.forEach(function(f) {
    const key   = mode === 'color' ? colorKey(f) : f.material;
    const label = mode === 'color' ? colorLabel(f) : f.material;
    if (!map.has(key)) map.set(key, { key: key, label: label, items: [] });
    map.get(key).items.push(f);
  });
  const groups = Array.from(map.values());
  if (mode === 'color') {
    groups.sort(function(a, b) {
      if (!a.key) return 1; if (!b.key) return -1;
      return a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' });
    });
  }
  return groups;
}
function groupIsFiltered(mode, key) {
  if (mode === 'none') return false;
  return mode === 'color' ? _filterColor === key : _filterMat === key;
}
function groupFilterCall(mode, key) {
  return (mode === 'color' ? 'setColorFilter' : 'setMaterialFilter') + "('" + escHtml(String(key).replace(/'/g, "\\'")) + "')";
}
function groupSwatches(items) {
  const seen = [];
  items.forEach(function(f) { const h = (f.color_hex || '').toLowerCase(); if (h && seen.indexOf(h) < 0) seen.push(h); });
  return seen.slice(0, 8).map(function(h) { return '<span class="group-swatch" style="background:' + escHtml(h) + '"></span>'; }).join('');
}

function setMaterialFilter(mat) {
  _filterMat = _filterMat === mat ? '' : mat; // toggle
  renderFilamentGrid();
}

function toggleSort(col) {
  if (_sortCol === col) {
    _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _sortCol = col;
    _sortDir = 'asc';
  }
  renderFilamentGrid();
}

function getVisibleCols() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('pf_filament_cols') || 'null'); } catch(_) { saved = null; }
  if (!saved) saved = ['nom','option','marque','spool_num','stock','longueur','progress','bobine'];
  const showPrices    = window._showPrices    === true;
  const showLocations = window._showLocations === true;
  return FILAMENT_COLS.filter(function(col) {
    if (col.setting === 'prices'    && !showPrices)    return false;
    if (col.setting === 'locations' && !showLocations) return false;
    return col.always || saved.includes(col.id);
  });
}

function saveVisibleCols(ids) {
  try { localStorage.setItem('pf_filament_cols', JSON.stringify(ids)); } catch(_) {}
}

function openColPicker() {
  const visible = getVisibleCols().map(function(c){ return c.id; });
  const showPrices    = window._showPrices    === true;
  const showLocations = window._showLocations === true;
  const rows = FILAMENT_COLS.filter(function(col) {
    if (col.setting === 'prices'    && !showPrices)    return false;
    if (col.setting === 'locations' && !showLocations) return false;
    return true;
  }).map(function(col) {
    const checked  = visible.includes(col.id);
    const disabled = col.always;
    return '<label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-radius:6px;cursor:' + (disabled ? 'default' : 'pointer') + ';' +
        (!disabled ? 'transition:background 0.1s" onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'"' : '"') + '>' +
      '<input type="checkbox" value="' + col.id + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + ' style="flex-shrink:0;width:16px;height:16px">' +
      '<div style="flex:1;min-width:0">' +
        '<span style="font-size:13px;color:' + (disabled ? 'var(--text3)' : 'var(--text)') + '">' + col.label + '</span>' +
        (disabled ? '<span style="font-size:11px;color:var(--text3);margin-left:6px">toujours visible</span>' : '') +
      '</div>' +
    '</label>';
  }).join('');

  openModal(
    '<div style="display:flex;flex-direction:column;gap:2px;margin-bottom:16px">' + rows + '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">' +
      '<button class="btn" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="applyColPicker()">Appliquer</button>' +
    '</div>',
    'Colonnes affichées'
  );
}

function applyColPicker() {
  const checks = document.querySelectorAll('#modal input[type=checkbox]');
  const ids = Array.from(checks).filter(function(ch){ return ch.checked; }).map(function(ch){ return ch.value; });
  saveVisibleCols(ids);
  closeModal();
  renderFilaments();
}

// Densités g/cm³ par matière pour calcul de longueur
const MATERIAL_DENSITY = {
  PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21,
  Nylon: 1.14, PC: 1.20, HIPS: 1.04, PVA: 1.19, CPE: 1.25, BVOH: 1.14,
  EVA: 0.93, PP: 0.90, PPA: 1.17, PPS: 1.35, autre: 1.24
};

function calcLength(weightG, diameterMm, material) {
  const d       = parseFloat(diameterMm) || 1.75;
  const density = MATERIAL_DENSITY[material] || 1.24;
  const r       = d / 2 / 10; // rayon en cm
  const volPerM = Math.PI * r * r * 100; // cm³ par mètre (100 cm)
  const massPerM= volPerM * density;     // g par mètre
  const meters  = parseFloat(weightG) / massPerM;
  if (!isFinite(meters) || meters <= 0) return null;
  return meters >= 1000 ? (meters / 1000).toFixed(2) + ' km' : Math.round(meters) + ' m';
}

const FINISH_OPTIONS  = ['Standard','Brillant','Mat','Soie','Marbre','Bois','Pailleté','Transparent','Opaque','Autre'];
const SPECIAL_OPTIONS = ['—','Renforcé fibre carbone','Renforcé fibre verre','Flexible','Conducteur','Ignifugé','Alimentaire','UV résistant','Autre'];

async function renderFilaments() {
  document.getElementById('page-title').textContent = 'Filaments';
  const activeAdv = countActiveFilAdvanced();
  document.getElementById('topbar-actions').innerHTML =
    `<label style="position:relative;display:inline-flex;align-items:center">
       <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Rechercher une bobine</span>
       <input id="filament-search" type="text" placeholder="Rechercher…"
         value="${_filterQuery}" oninput="setFilamentFilter(this.value)"
         style="width:220px;padding-right:28px" class="fil-search">
       ${_filterQuery ? '<button type="button" aria-label="Effacer la recherche" onclick="setFilamentFilter(\'\')" style="position:absolute;right:6px;background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px">✕</button>' : ''}
     </label>
     <button type="button" class="btn hide-sm" onclick="toggleFilAdvanced()" style="${activeAdv > 0 ? 'border-color:var(--accent);color:var(--accent)' : ''}">
       Filtres${activeAdv > 0 ? ' · ' + activeAdv : ''}
     </button>
     <div style="position:relative">
       <button type="button" class="btn" onclick="toggleFilMoreMenu(event)" aria-haspopup="true">Outils ▾</button>
       <div id="fil-more-menu" class="drop-menu" style="display:none">
         <button type="button" class="show-sm" onclick="closeFilMoreMenu();openFilamentForm()">Ajouter une bobine</button>
         <button type="button" class="show-sm" onclick="closeFilMoreMenu();toggleFilAdvanced()">Filtres avancés</button>
         <button type="button" onclick="closeFilMoreMenu();toggleShowArchived()">${showArchived ? 'Masquer les archivées' : 'Voir les archivées'}</button>
         <button type="button" onclick="closeFilMoreMenu();openLabelEditor()">Étiquettes</button>
         ${_filView === 'list' ? '<button type="button" onclick="closeFilMoreMenu();openColPicker()">Colonnes du tableau</button>' : ''}
         <hr>
         <button type="button" onclick="closeFilMoreMenu();openImportCSV()">Importer un CSV</button>
         <button type="button" onclick="closeFilMoreMenu();exportFilamentsCSV()">Exporter en CSV</button>
         <button type="button" onclick="closeFilMoreMenu();exportFilamentsPDF()">Exporter en PDF</button>
       </div>
     </div>
     <button type="button" class="btn hide-sm" onclick="openFilamentForm()">+ Ajouter</button>
     <button type="button" class="btn btn-primary hide-sm" onclick="openWeighingModal()">Pesée</button>`;
  document.getElementById('content').innerHTML = '<div style="color:var(--text3);padding:20px 0">Chargement…</div>';
  allFilaments = await API.get('/filaments' + (showArchived ? '?archived=1' : ''));
  window._allFilaments = allFilaments;
  renderFilamentGrid();
}

function toggleFilAdvanced() {
  _filAdvancedOpen = !_filAdvancedOpen;
  renderFilamentGrid();
  renderFilaments(); // rebind topbar button color
}

function resetFilAdvanced() {
  _filAdvanced = { finish:'', special:'', diameter:'', location:'', nfc:'', stock_min:'', stock_max:'', pct_max:'' };
  _filAdvancedOpen = false;
  renderFilaments();
}

function renderFilAdvancedPanel() {
  if (!_filAdvancedOpen) return '';
  const A = _filAdvanced;

  const finishes  = ['Standard','Silk','Matte','Transparent','Fluorescent','Glow','Galaxy','Marble','Wood','Metal','Carbon'];
  const specials  = ['—','Conducteur','Magnétique','Antibactérien','Ignifugé','Flexible','Soluble'];

  return '<div style="background:var(--bg3);border:0.5px solid var(--border2);border-radius:var(--radius);' +
    'padding:14px;margin-bottom:12px">' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:10px">' +

    // Finition
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Finition</label>' +
    '<select onchange="_filAdvanced.finish=this.value;renderFilamentGrid()" style="width:100%;font-size:12px">' +
    '<option value="">Toutes</option>' +
    finishes.map(function(o) { return '<option value="' + o + '"' + (A.finish===o?' selected':'') + '>' + o + '</option>'; }).join('') +
    '</select></div>' +

    // Propriété spéciale
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Propriété spéciale</label>' +
    '<select onchange="_filAdvanced.special=this.value;renderFilamentGrid()" style="width:100%;font-size:12px">' +
    '<option value="">Toutes</option>' +
    specials.map(function(o) { return '<option value="' + o + '"' + (A.special===o?' selected':'') + '>' + o + '</option>'; }).join('') +
    '</select></div>' +

    // Diamètre
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Diamètre</label>' +
    '<select onchange="_filAdvanced.diameter=this.value;renderFilamentGrid()" style="width:100%;font-size:12px">' +
    '<option value="">Tous</option>' +
    ['1.75','2.85'].map(function(d) { return '<option value="' + d + '"' + (A.diameter===d?' selected':'') + '>' + d + ' mm</option>'; }).join('') +
    '</select></div>' +

    // NFC
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Puce NFC</label>' +
    '<select onchange="_filAdvanced.nfc=this.value;renderFilamentGrid()" style="width:100%;font-size:12px">' +
    '<option value="">Toutes</option>' +
    '<option value="with"' + (A.nfc==='with'?' selected':'') + '>Avec puce</option>' +
    '<option value="without"' + (A.nfc==='without'?' selected':'') + '>Sans puce</option>' +
    '</select></div>' +

    // Stock min
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Stock min (g)</label>' +
    '<input type="number" value="' + (A.stock_min||'') + '" placeholder="ex: 100" ' +
    'oninput="_filAdvanced.stock_min=this.value;renderFilamentGrid()" style="width:100%;font-size:12px"></div>' +

    // Stock max
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Stock max (g)</label>' +
    '<input type="number" value="' + (A.stock_max||'') + '" placeholder="ex: 800" ' +
    'oninput="_filAdvanced.stock_max=this.value;renderFilamentGrid()" style="width:100%;font-size:12px"></div>' +

    // Stock faible %
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Stock faible — max %</label>' +
    '<select onchange="_filAdvanced.pct_max=this.value;renderFilamentGrid()" style="width:100%;font-size:12px">' +
    '<option value="">Tous</option>' +
    ['10','15','20','25','50'].map(function(p) { return '<option value="' + p + '"' + (A.pct_max===p?' selected':'') + '>≤ ' + p + '%</option>'; }).join('') +
    '</select></div>' +

    // Emplacement (seulement si activé dans les paramètres)
    (window._showLocations ? '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Emplacement</label>' +
    '<input type="text" value="' + (A.location||'') + '" placeholder="ex: Tiroir 2" ' +
    'oninput="_filAdvanced.location=this.value;renderFilamentGrid()" style="width:100%;font-size:12px"></div>' : '') +

    '</div>' +
    '<div style="display:flex;gap:8px;align-items:center">' +
      '<span id="fil-adv-count" style="font-size:12px;color:var(--text3)"></span>' +
      '<button onclick="resetFilAdvanced()" style="font-size:12px;padding:4px 10px;border-radius:var(--radius);' +
        'border:0.5px solid var(--border2);background:var(--bg2);color:var(--text3);cursor:pointer">↺ Réinitialiser</button>' +
    '</div>' +
  '</div>';
}

function setFilamentFilter(q) {
  _filterQuery = q;
  renderFilamentGrid();
  // Mettre à jour le champ sans re-render complet
  const input = document.getElementById('filament-search');
  if (input && document.activeElement !== input) input.value = q;
}

async function toggleShowArchived() {
  showArchived = !showArchived;
  await renderFilaments();
}

// ── Bandeau stock faible (remplace l'alerte du tableau de bord) ──────────
function renderLowStockBanner() {
  if (!window._stockAlertEnabled) return '';
  const threshold = window._stockAlertThreshold || 20;
  const low = allFilaments.filter(function(f) {
    return !f.archived && f.weight_total > 0 &&
           (f.weight_remaining / f.weight_total * 100) <= threshold;
  });
  if (!low.length) return '';
  const active = _filAdvanced.pct_max === String(threshold);
  const names = low.slice(0, 4).map(function(f) { return escHtml(f.name); }).join(' · ') + (low.length > 4 ? ' …' : '');
  return '<div class="hazard" role="status">' +
    '<div class="hazard-stripes" aria-hidden="true"></div>' +
    '<div class="hazard-body">' +
      '<div><span class="hazard-title">' + low.length + ' bobine' + (low.length > 1 ? 's' : '') + ' sous ' + threshold + ' %</span>' +
      '<span class="hazard-names">' + names + '</span></div>' +
      '<button type="button" class="btn btn-sm" onclick="_filAdvanced.pct_max=' + (active ? "''" : "'" + threshold + "'") +
      ';renderFilamentGrid()">' + (active ? 'Tout afficher' : 'Afficher') + '</button>' +
    '</div>' +
  '</div>';
}

// ── Vue Atelier : en-tête, filtres par matière, cartes bobines ───────────
function escHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

function setFilView(v) {
  _filView = v;
  try { localStorage.setItem('ff_fil_view', v); } catch(_) {}
  renderFilaments();
}

function setGridSort(v) {
  _sortCol = v || null;
  _sortDir = 'asc';
  renderFilamentGrid();
}

function toggleFilMoreMenu(ev) {
  if (ev) ev.stopPropagation();
  const m = document.getElementById('fil-more-menu');
  if (!m) return;
  const open = m.style.display !== 'none';
  m.style.display = open ? 'none' : 'block';
  if (!open) setTimeout(function() { document.addEventListener('click', closeFilMoreMenu, { once: true }); }, 0);
}
function closeFilMoreMenu() {
  const m = document.getElementById('fil-more-menu');
  if (m) m.style.display = 'none';
}

function renderFilHeader() {
  const active = allFilaments.filter(function(f) { return !f.archived; });
  const nfc = active.filter(function(f) { return f.nfc_uid; }).length;
  const threshold = window._stockAlertThreshold || 20;
  const stats = showArchived
    ? allFilaments.length + ' bobine' + (allFilaments.length > 1 ? 's' : '') + ' archivée' + (allFilaments.length > 1 ? 's' : '')
    : active.length + ' bobine' + (active.length > 1 ? 's' : '') + ' · ' + nfc + ' puce' + (nfc > 1 ? 's' : '') + ' NFC' +
      (window._stockAlertEnabled ? ' · seuil d\'alerte ' + threshold + ' %' : '');
  return '<div class="fil-head"><div><h1>' + (showArchived ? 'Archives' : 'Stock filament') + '</h1>' +
    '<div class="fil-stats">' + stats + '</div></div></div>';
}

function renderFilToolbar() {
  const counts = {};
  allFilaments.forEach(function(f) { counts[f.material] = (counts[f.material] || 0) + 1; });
  const mats = Object.keys(counts).sort();
  const chips = '<button type="button" class="chip' + (!_filterMat ? ' active' : '') + '" onclick="_filterMat=\'\';renderFilamentGrid()">Tous · ' + allFilaments.length + '</button>' +
    mats.map(function(m) {
      return '<button type="button" class="chip' + (_filterMat === m ? ' active' : '') + '" onclick="setMaterialFilter(\'' + escHtml(m) + '\')">' + escHtml(m) + ' · ' + counts[m] + '</button>';
    }).join('');
  const grp = getFilGroup();
  const grpSel = '<label>Regrouper <select onchange="setFilGroup(this.value)" aria-label="Regrouper les bobines">' +
    [['none', 'Aucun'], ['material', 'Matière'], ['color', 'Couleur']].map(function(o) {
      return '<option value="' + o[0] + '"' + (grp === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select></label>';
  let colorChip = '';
  if (_filterColor) {
    const ref = allFilaments.find(function(f) { return colorKey(f) === _filterColor; });
    colorChip = '<button type="button" class="chip active" onclick="setColorFilter(\'' + escHtml(_filterColor) + '\')" aria-label="Retirer le filtre couleur">Couleur : ' +
      escHtml(ref ? colorLabel(ref) : _filterColor) + ' ✕</button>';
  }
  const sortOpts = [['', 'Par défaut'], ['pct', 'Stock restant ↑'], ['name', 'Nom']];
  const sortSel = '<label>Tri <select onchange="setGridSort(this.value)" aria-label="Trier les bobines">' +
    sortOpts.map(function(o) { return '<option value="' + o[0] + '"' + ((_sortCol || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
    '</select></label>';
  return '<div class="fil-toolbar">' +
    '<div class="chip-row" role="group" aria-label="Filtrer par matière">' + chips + colorChip + '</div>' +
    '<div class="view-switch">' + grpSel + sortSel +
      '<button type="button" class="' + (_filView === 'grid' ? 'active' : '') + '" onclick="setFilView(\'grid\')">Grille</button>' +
      '<button type="button" class="' + (_filView === 'list' ? 'active' : '') + '" onclick="setFilView(\'list\')">Liste</button>' +
    '</div></div>';
}

function filamentMenuHtml(f) {
  return '<div id="fmenu-' + f.id + '" class="drop-menu" style="display:none" onclick="event.stopPropagation()">' +
    '<button type="button" onclick="closeFilamentMenu();openFilamentForm(' + f.id + ')">Modifier</button>' +
    '<button type="button" onclick="closeFilamentMenu();openWeighingHistory(' + f.id + ')">Historique des pesées</button>' +
    '<button type="button" onclick="closeFilamentMenu();openNfcScanModal(' + f.id + ')">Puce NFC</button>' +
    '<button type="button" onclick="closeFilamentMenu();openFilamentQR(' + f.id + ')">QR code</button>' +
    (!f.parent_filament_id ? '<button type="button" onclick="closeFilamentMenu();openFilamentForm(null,' + f.id + ')">Bobine partielle</button>' : '') +
    '<button type="button" onclick="closeFilamentMenu();duplicateFilament(' + f.id + ')">Dupliquer</button>' +
    '<hr>' +
    '<button type="button" onclick="closeFilamentMenu();quickToggleArchive(' + f.id + ',' + (f.archived ? 1 : 0) + ')">' + (f.archived ? 'Désarchiver' : 'Archiver') + '</button>' +
    '<button type="button" style="color:var(--danger)" onclick="closeFilamentMenu();deleteFilament(' + f.id + ')">Supprimer</button>' +
  '</div>';
}

function fmtWeighDate(str) {
  if (!str) return 'Aucune pesée';
  const d = new Date(String(str).replace(' ', 'T'));
  if (isNaN(d)) return 'Aucune pesée';
  return 'Pesée ' + d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }).replace('/', '.') +
    ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function spoolCardHtml(f) {
  const threshold = window._stockAlertThreshold || 20;
  const total = parseFloat(f.weight_total) || 0;
  const rem   = Math.max(0, parseFloat(f.weight_remaining) || 0);
  const p     = total > 0 ? Math.min(100, Math.round(rem / total * 100)) : 0;
  const low   = window._stockAlertEnabled && !f.archived && total > 0 && p <= threshold;
  const C     = 2 * Math.PI * 33;
  const dash  = (p / 100 * C).toFixed(1) + ' ' + C.toFixed(1);
  const color = f.color_hex || '#888888';
  const len   = calcLength(rem, f.diameter, f.material);
  const code  = escHtml(f.material) + ' · Ø' + (parseFloat(f.diameter) || 1.75) + (f.spool_number ? ' · #' + escHtml(f.spool_number) : '');
  const sub   = [f.brand, f.color_name].filter(Boolean).map(escHtml).join(' · ');
  const tags  =
    (low ? '<span class="tag tag-low">Stock bas</span>' : '') +
    (f.parent_filament_id ? '<span class="tag">Partielle' + (f.spool_label ? ' · ' + escHtml(f.spool_label) : '') + '</span>' : '') +
    (f.archived ? '<span class="tag">Archivée</span>' : '') +
    (f.nfc_uid ? '<span class="tag" title="Puce NFC : ' + escHtml(f.nfc_uid) + '">NFC</span>' : '');
  return '<div class="spool-card' + (low ? ' low' : '') + (f.archived ? ' archived' : '') + (f.parent_filament_id ? ' partial' : '') + '"' +
      ' tabindex="0" role="button" aria-label="Ouvrir la fiche ' + escHtml(f.name) + '"' +
      ' onclick="openFilamentForm(' + f.id + ')" onkeydown="if(event.key===\'Enter\')openFilamentForm(' + f.id + ')">' +
    '<div class="spool-top"><span class="spool-code">' + code + '</span><span class="spool-tags">' + tags + '</span></div>' +
    '<div class="spool-mid">' +
      '<svg class="spool-ring" width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">' +
        '<circle cx="38" cy="38" r="33" fill="none" stroke="var(--ring-track)" stroke-width="8"></circle>' +
        '<circle cx="38" cy="38" r="33" fill="none" stroke="' + escHtml(color) + '" stroke-width="8" stroke-dasharray="' + dash + '" transform="rotate(-90 38 38)"></circle>' +
        '<circle cx="38" cy="38" r="37.5" fill="none" stroke="var(--ring-edge)" stroke-width="1"></circle>' +
        '<circle cx="38" cy="38" r="28.5" fill="none" stroke="var(--ring-edge)" stroke-width="1"></circle>' +
        '<text x="38" y="42.5" text-anchor="middle">' + p + '%</text>' +
      '</svg>' +
      '<div style="min-width:0"><div class="spool-name">' + escHtml(f.name) + '</div>' +
        (sub ? '<div class="spool-brand">' + sub + '</div>' : '') + '</div>' +
    '</div>' +
    '<div class="spool-weight"><div><span class="w">' + Math.round(rem) + '</span> <span class="wt">/ ' + Math.round(total) + ' g</span></div>' +
      (len ? '<span class="len">≈ ' + len + '</span>' : '') + '</div>' +
    '<div class="spool-foot"><span class="spool-last">' + fmtWeighDate(f.last_weighed_at) + '</span>' +
      '<span class="spool-actions" onclick="event.stopPropagation()">' +
        '<button type="button" class="btn btn-sm" onclick="openWeighingModal(' + f.id + ')">Pesée</button>' +
        '<button type="button" class="btn btn-sm" aria-label="Plus d\'actions" onclick="toggleFilamentMenu(' + f.id + ',this)">•••</button>' +
        filamentMenuHtml(f) +
      '</span></div>' +
  '</div>';
}

function renderFilamentGrid() {
  const content = document.getElementById('content');
  if (!allFilaments.length) {
    content.innerHTML = renderFilHeader() + renderFilAdvancedPanel() + '<div class="empty-state"><p>' + (showArchived ? 'Aucune bobine archivée.' : 'Aucun filament en stock.') + '</p></div>';
    return;
  }
  const filtered   = filterFilaments(allFilaments);
  const displayed  = sortFilaments(filtered);
  const totalCount = filtered.length;

  // Réordonner : les bobines partielles apparaissent juste après leur parent
  const ordered = [];
  const parents = displayed.filter(function(f) { return !f.parent_filament_id; });
  parents.forEach(function(p) {
    ordered.push(p);
    displayed.filter(function(c) { return String(c.parent_filament_id) === String(p.id); })
             .forEach(function(c) { ordered.push(c); });
  });
  // Orphelines (parent archivé/supprimé) à la fin
  displayed.filter(function(f) {
    return f.parent_filament_id && !parents.find(function(p) { return String(p.id) === String(f.parent_filament_id); });
  }).forEach(function(f) { ordered.push(f); });


  // Mettre à jour le compteur dans le panneau si visible
  setTimeout(function() {
    const el = document.getElementById('fil-adv-count');
    if (el) el.textContent = totalCount + ' bobine' + (totalCount !== 1 ? 's' : '') + ' trouvée' + (totalCount !== 1 ? 's' : '');
  }, 0);

  if (!totalCount) {
    content.innerHTML = renderFilHeader() + renderFilToolbar() + renderFilAdvancedPanel() +
      '<div class="empty-state"><p>Aucun filament ne correspond aux filtres.</p></div>';
    return;
  }

  const grpMode = getFilGroup();
  const groups  = buildFilGroups(ordered, grpMode);

  if (_filView === 'grid') {
    const body = grpMode === 'none'
      ? '<div class="spool-grid">' + ordered.map(spoolCardHtml).join('') + '</div>'
      : groups.map(function(g) {
          const on = groupIsFiltered(grpMode, g.key);
          return '<section class="group">' +
            '<button type="button" class="group-head' + (on ? ' on' : '') + '" onclick="' + groupFilterCall(grpMode, g.key) + '"' +
              ' title="' + (on ? 'Afficher tous les groupes' : 'Afficher seulement ce groupe') + '">' +
              '<span class="group-title">' + escHtml(g.label) + '</span>' +
              (grpMode === 'color' ? '<span class="group-swatches">' + groupSwatches(g.items) + '</span>' : '') +
              '<span class="group-count">' + g.items.length + ' bobine' + (g.items.length > 1 ? 's' : '') + (on ? ' · ✕' : '') + '</span>' +
            '</button>' +
            '<div class="spool-grid">' + g.items.map(spoolCardHtml).join('') + '</div>' +
          '</section>';
        }).join('');
    content.innerHTML = renderFilHeader() + renderFilToolbar() + renderLowStockBanner() + renderFilAdvancedPanel() + body;
    return;
  }

  content.innerHTML = renderFilHeader() + renderFilToolbar() + renderLowStockBanner() + renderFilAdvancedPanel() + groups.map(g => { const filaments = g.items; const on = groupIsFiltered(grpMode, g.key); return `
    <div class="card">
      <div class="card-header" ${grpMode === 'none' ? '' : `style="cursor:pointer" onclick="${groupFilterCall(grpMode, g.key)}"
           title="${on ? 'Afficher tous les groupes' : 'Filtrer sur ' + escHtml(g.label)}"`}>
        <span class="card-title" style="display:flex;align-items:center;gap:10px;${on ? 'color:var(--accent)' : ''}">${escHtml(g.label)}
          ${grpMode === 'color' ? '<span class="group-swatches">' + groupSwatches(filaments) + '</span>' : ''}
          ${on ? '<span style="font-size:11px;font-weight:normal;color:var(--accent)">● filtré</span>' : ''}
        </span>
        <span style="font-size:12px;color:var(--text3)">${filaments.length} bobine${filaments.length>1?'s':''}
          ${grpMode === 'none' ? '' : `<span style="font-size:11px;opacity:0.5;margin-left:4px">${on ? '✕' : '▼'}</span>`}
        </span>
      </div>
      <table style="table-layout:fixed;width:100%">
        <colgroup>
          ${(function(){ const v=getVisibleCols(); const w=computeColWidths(v); return v.map(function(col,i){ return '<col style="width:'+w[i]+'">'; }).join(''); })()}
          <col style="width:200px">
        </colgroup>
        <thead><tr>
          ${getVisibleCols().map(function(col) {
            const colToField = {nom:'name',marque:'brand',stock:'weight_remaining',longueur:'weight_remaining',
              prix:'price',emplacement:'location',spool_num:'spool_number',option:'finish_option',finition:'finish_option'};
            const field = colToField[col.id];
            const isSorted = field && _sortCol === field;
            const arrow = isSorted ? (_sortDir === 'asc' ? ' ↑' : ' ↓') : '';
            const clickable = field ? 'onclick="toggleSort(\'' + field + '\')" style="cursor:pointer;user-select:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (isSorted ? 'color:var(--accent)' : '') + '"' : 'style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"';
            return '<th ' + clickable + '>' + col.label + arrow + '</th>';
          }).join('')}
          <th></th>
        </tr></thead>
        <tbody>
          ${filaments.map(f => {
            const p = pct(f.weight_remaining, f.weight_total);
            const barColor = p < 15 ? 'var(--danger)' : p < 25 ? 'var(--warning)' : 'var(--accent)';
            const optLabel = [
              f.finish_option && f.finish_option !== 'Standard' ? f.finish_option : null,
              f.special_option && f.special_option !== '—' ? f.special_option : null
            ].filter(Boolean).join(' · ');
            const visCols = getVisibleCols().map(c => c.id);
            const isPartial = !!f.parent_filament_id;
            const partialBadge = isPartial
              ? `<span style="font-size:10px;padding:1px 6px;background:#f59e0b22;color:#f59e0b;
                   border-radius:10px;flex-shrink:0">Partielle${f.spool_label ? ' · '+f.spool_label : ''}</span>`
              : '';
            // Stock total du groupe (parent + enfants)
            // Stock total du groupe — comparaison robuste (int vs string)
            const children = allFilaments.filter(function(c) {
              return String(c.parent_filament_id) === String(f.id) && !c.archived;
            });
            const groupStock = children.length
              ? Math.round(parseFloat(f.weight_remaining||0) + children.reduce(function(s,c){ return s + parseFloat(c.weight_remaining||0); }, 0))
              : null;
            const groupBadge = groupStock !== null
              ? `<span style="font-size:10px;padding:1px 6px;background:var(--accent-bg);color:var(--accent);
                   border-radius:10px;flex-shrink:0" title="Stock total du groupe">
                   Σ ${groupStock}g</span>`
              : '';

            const tdNom = `<td style="opacity:${f.archived?'0.55':'1'}">
                <div style="display:flex;align-items:center;gap:8px;${isPartial ? 'padding-left:18px' : ''}">
                  ${isPartial ? '<span style="color:var(--text3);font-size:14px;flex-shrink:0">↳</span>' : ''}
                  <span class="filament-dot" style="background:${f.color_hex};width:14px;height:14px"></span>
                  <span style="font-weight:500">${f.name}</span>
                  ${f.archived ? `<span style="font-size:10px;padding:1px 6px;background:var(--bg3);color:var(--text3);border-radius:10px">Archivé</span>` : ''}
                  ${f.nfc_uid ? `<span title="Puce NFC liée : ${f.nfc_uid}" style="font-size:10px;padding:1px 5px;background:var(--accent-bg);color:var(--accent);border-radius:10px;cursor:pointer" onclick="openNfcScanModal(${f.id})">📡 NFC</span>` : ''}
                  ${partialBadge}
                  ${groupBadge}
                </div></td>`;
            const tdMap = {
              couleur:     `<td style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${f.color_hex ? `<span style="display:flex;align-items:center;gap:5px">
                    <span style="width:10px;height:10px;border-radius:50%;background:${f.color_hex};flex-shrink:0;display:inline-block"></span>
                    <span style="color:var(--text2)">${f.color_name||''}</span>
                  </span>` : '—'}
                </td>`,
              option:      `<td style="font-size:12px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${optLabel || '—'}</td>`,
              finition:    `<td style="font-size:12px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.finish_option && f.finish_option !== 'Standard' ? f.finish_option : '—'}</td>`,
              marque:      `<td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.brand||'—'}</td>`,
              spool_num:   `<td style="font-size:12px;font-weight:500;color:var(--text2)">${f.spool_number||'—'}</td>`,
              stock:       `<td><span style="font-weight:500;color:${p<20?'var(--warning)':'var(--text)'}">${Math.round(f.weight_remaining)}g</span><span style="color:var(--text3);font-size:11px"> / ${f.weight_total}g</span></td>`,
              longueur:    `<td style="font-size:12px;color:var(--text2);white-space:nowrap">${calcLength(f.weight_remaining, f.diameter, f.material) || '—'}</td>`,
              progress:    `<td style="min-width:100px"><div style="display:flex;align-items:center;gap:8px"><div class="progress-wrap" style="flex:1"><div class="progress-fill" style="width:${p}%;background:${barColor}"></div></div><span style="font-size:11px;color:var(--text3);min-width:30px">${p}%</span></div></td>`,
              bobine:      `<td style="font-size:12px;color:var(--text3)">${f.spool_weight ? f.spool_weight+'g' : '—'}</td>`,
              prix:        `<td style="font-size:12px">${f.price ? f.price+'€' : '—'}</td>`,
              emplacement: `<td style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.location||'—'}</td>`,
            };
            return `<tr>
              ${tdNom}
              ${visCols.filter(id => id !== 'nom').map(id => tdMap[id] || '').join('')}
              <td style="width:200px;min-width:200px"><div class="td-actions">
                <button class="btn btn-sm" title="Pesée" onclick="openWeighingModal(${f.id})">Pesée</button>
                <button class="btn btn-sm" onclick="openFilamentForm(${f.id})">✏</button>
                <button class="btn btn-sm btn-danger" onclick="deleteFilament(${f.id})">✕</button>
                <div style="position:relative;display:inline-block">
                  <button class="btn btn-sm" onclick="toggleFilamentMenu(${f.id},this)" title="Plus d'actions">•••</button>
                  ${filamentMenuHtml(f)}
                </div>
              </div></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`; }).join('');
}

function openFilamentForm(id = null, defaultParentId = null, sourceData = null) {
  // sourceData : données pré-remplies pour duplication
  const f = sourceData || (id ? allFilaments.find(x => x.id === id) : {});
  const isDuplicate = !!sourceData;
  const parentId = f.parent_filament_id || defaultParentId || null;

  // Filaments éligibles comme parents (non partiels, non archivés, pas soi-même)
  const eligibleParents = allFilaments.filter(function(p) {
    return !p.parent_filament_id && !p.archived && p.id !== id;
  });

  const parentSection = `
    <div style="font-size:11px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Bobine partielle <span style="font-weight:400;text-transform:none;font-size:11px">(optionnel)</span></div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:14px;
      padding:12px;background:${parentId ? 'var(--accent-bg)' : 'var(--bg3)'};border-radius:var(--radius);
      border:0.5px solid ${parentId ? 'var(--accent)' : 'var(--border2)'}">
      <div>
        <label class="form-label">Rattacher à un filament parent</label>
        <select id="ff-parent-id" onchange="onParentChange(this)">
          <option value="">— Bobine indépendante —</option>
          ${eligibleParents.map(p =>
            `<option value="${p.id}" ${parentId==p.id?'selected':''}>${p.name} (${p.material} · ${Math.round(p.weight_remaining)}g restants)</option>`
          ).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">Étiquette <span style="font-size:10px;color:var(--text3)">(ex: Reste mars)</span></label>
        <input id="ff-spool-label" value="${f.spool_label||''}" placeholder="ex: Bobine A">
      </div>
      ${parentId ? `<div style="grid-column:1/-1;font-size:11px;color:var(--accent)">
        ℹ Cette bobine sera regroupée avec son parent dans la liste. Le stock total du groupe sera affiché automatiquement.
      </div>` : ''}
    </div>`;
  openModal(`
    <!-- Section 1 : Identité -->
    <div style="font-size:11px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Identification</div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:14px">
      <div><label class="form-label">Nom *</label><input id="ff-name" value="${f.name||''}"></div>
      <div><label class="form-label">Marque</label><input id="ff-brand" value="${f.brand||''}"></div>
      <div><label class="form-label">N° de bobine</label><input id="ff-spool-num" value="${f.spool_number||''}" placeholder="ex: SN-001"></div>
    </div>

    <!-- Section 2 : Matière & couleur -->
    <div style="font-size:11px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Matière & couleur</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px">
      <div><label class="form-label">Matière</label>
        <select id="ff-mat" onchange="refreshElegooSubtypes()">
          ${['PLA','PETG','ABS','ASA','TPU','Nylon','PC','HIPS','PVA','CPE','BVOH','EVA','PP','PPA','PPS','autre'].map(m =>
            `<option ${(f.material||'PLA')==m?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div><label class="form-label">Sous-type ELEGOO</label>
        <select id="ff-elegoo-subtype" data-current="${escHtml(f.elegoo_subtype || '')}" onchange="updateElegooHint()">
          <option value="">Standard</option>
        </select>
        <div id="ff-elegoo-hint" style="font-size:11px;color:var(--text3);margin-top:4px;min-height:14px"></div>
      </div>
      <div><label class="form-label">Finition</label>
        <select id="ff-finish">
          ${FINISH_OPTIONS.map(o => `<option ${(f.finish_option||'Standard')==o?'selected':''}>${o}</option>`).join('')}
        </select>
      </div>
      <div><label class="form-label">Propriété spéciale</label>
        <select id="ff-special">
          ${SPECIAL_OPTIONS.map(o => `<option ${(f.special_option||'—')==o?'selected':''}>${o}</option>`).join('')}
        </select>
      </div>
      <div><label class="form-label">Couleur</label>
        <input id="ff-color" type="color" value="${f.color_hex||'#cccccc'}" style="height:36px;width:100%;padding:2px 4px">
      </div>
      <div><label class="form-label">Nom couleur</label><input id="ff-colorname" value="${f.color_name||''}"></div>
      <div><label class="form-label">Diamètre (mm)</label>
        <select id="ff-diam">
          <option ${(f.diameter||1.75)==1.75?'selected':''}>1.75</option>
          <option ${(f.diameter||1.75)==2.85?'selected':''}>2.85</option>
        </select>
      </div>
      <div></div>
    </div>

    <!-- Section 3 : Stock & prix -->
    <div style="font-size:11px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Stock</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr ${window._showPrices ? '1fr' : ''};gap:10px;margin-bottom:14px">
      <div><label class="form-label">Poids total (g)</label><input id="ff-wtot" type="number" value="${f.weight_total||1000}" oninput="validateWeights()"></div>
      <div><label class="form-label">Poids restant (g)</label><input id="ff-wrem" type="number" value="${f.weight_remaining||1000}" oninput="validateWeights()"></div>
      <div>
        <label class="form-label">Poids bobine vide (g)</label>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="ff-spool" type="number" step="0.1" value="${f.spool_weight||''}" placeholder="ex: 230" style="flex:1">
          <button type="button" class="btn btn-sm" onclick="openSpoolWeightPicker()" title="Choisir depuis la base">📋</button>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px">Ou choisissez depuis la base de référence</div>
      </div>
      ${window._showPrices ? `<div><label class="form-label">Prix (€/kg)</label><input id="ff-price" type="number" step="0.01" value="${f.price||''}"></div>` : ''}
    </div>

    <!-- Section 4 : Températures -->
    <div style="font-size:11px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Températures</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px">
      <div><label class="form-label">Buse min (°C)</label><input id="ff-tnmin" type="number" value="${f.temp_nozzle_min||190}"></div>
      <div><label class="form-label">Buse max (°C)</label><input id="ff-tnmax" type="number" value="${f.temp_nozzle_max||230}"></div>
      <div><label class="form-label">Plateau min (°C)</label><input id="ff-tbmin" type="number" value="${f.temp_bed_min||0}"></div>
      <div><label class="form-label">Plateau max (°C)</label><input id="ff-tbmax" type="number" value="${f.temp_bed_max||60}"></div>
    </div>

    <!-- Section 5 : Autres -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
      ${window._showLocations ? `<div><label class="form-label">Emplacement</label><input id="ff-loc" value="${f.location||''}"></div>` : ''}
      <div><label class="form-label">Fournisseur</label><input id="ff-supplier" value="${f.supplier||''}" placeholder="ex: Amazon, Bambu..."></div>
      <div><label class="form-label">Date d'achat</label><input id="ff-purchase-date" type="date" value="${f.purchase_date ? f.purchase_date.slice(0,10) : ''}"></div>
    </div>
    <div style="margin-bottom:14px">
      <label class="form-label">Notes</label>
      <textarea id="ff-notes" rows="2" style="width:100%;resize:vertical">${f.notes||''}</textarea>
    </div>

    <!-- Section 6 : NFC + Statut sur une ligne -->
    ${parentSection}
    <div style="display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start">
      <div>
        <label class="form-label">Puce NFC</label>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${f.nfc_uid
            ? `<code style="font-size:12px;background:var(--bg3);padding:4px 10px;border-radius:var(--radius)">${f.nfc_uid}</code>
               <span style="font-size:11px;color:var(--success)">✓ Puce liée</span>
               <button class="btn btn-sm btn-danger" onclick="nfcUnlinkFilament(${f.id||'null'});closeModal()">Délier</button>`
            : `<span style="font-size:12px;color:var(--text3)">Aucune puce liée</span>`}
          <button class="btn btn-sm" onclick="closeModal();openNfcScanModal(${f.id||'null'})">
            📡 ${f.nfc_uid ? 'Remplacer' : 'Lier une puce'}
          </button>
          ${f.nfc_uid ? `<button class="btn btn-sm" style="background:var(--accent-bg);color:var(--accent);font-weight:500"
            onclick="closeModal();writeElegooFromFilament(${f.id})">◈ Écrire ELEGOO</button>` : ''}
          ${f.id ? `<button class="btn btn-sm" onclick="openNfcHistory(${f.id})">📋 Historique</button>` : ''}
        </div>
      </div>
      <div>
        <label class="form-label">Statut</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:4px">
          <div onclick="toggleArchiveInForm(this)" id="ff-archive-toggle"
               data-archived="${f.archived?'1':'0'}"
               style="width:40px;height:22px;border-radius:11px;cursor:pointer;transition:background 0.2s;
                      background:${f.archived?'var(--accent)':'var(--border2)'};position:relative;flex-shrink:0">
            <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;
                        top:2px;transition:left 0.2s;left:${f.archived?'19px':'2px'}"></div>
          </div>
          <span style="font-size:12px" id="ff-archive-label">${f.archived?'Archivée':'Active'}</span>
        </label>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn btn-primary" onclick="saveFilament(${id||'null'})">Enregistrer</button>
    </div>`, id ? 'Modifier filament' : (isDuplicate ? 'Nouveau filament (copie de ' + (f.name||'') + ')' : (defaultParentId ? 'Ajouter une bobine partielle' : 'Ajouter un filament')), { wide: true });
  refreshElegooSubtypes();
}

// ── Sous-types ELEGOO dépendant de la matière (source : backend/elegoo.js) ──
async function refreshElegooSubtypes() {
  const sel = document.getElementById('ff-elegoo-subtype');
  const mat = document.getElementById('ff-mat');
  if (!sel || !mat) return;
  if (!window._elegooSubtypes) {
    try { window._elegooSubtypes = await API.get('/nfc/elegoo-subtypes'); }
    catch (_) { window._elegooSubtypes = null; }
  }
  const keep = sel.value || sel.dataset.current || '';
  const list = (window._elegooSubtypes || {})[mat.value] || [];
  sel.innerHTML = '<option value="">Standard' + (mat.value === 'autre' ? '' : ' (' + (mat.value === 'Nylon' ? 'PA' : mat.value) + ')') + '</option>' +
    list.map(function(s) {
      return '<option value="' + escHtml(s.name) + '"' + (s.name === keep ? ' selected' : '') + '>' +
        escHtml(s.name) + (s.hidden ? ' — non affiché CC2' : '') + '</option>';
    }).join('');
  sel.dataset.current = list.some(function(s) { return s.name === keep; }) ? keep : '';
  updateElegooHint();
}

function updateElegooHint() {
  const sel  = document.getElementById('ff-elegoo-subtype');
  const mat  = document.getElementById('ff-mat');
  const hint = document.getElementById('ff-elegoo-hint');
  if (!sel || !mat || !hint) return;
  const list = (window._elegooSubtypes || {})[mat.value] || [];
  const cur  = list.find(function(s) { return s.name === sel.value; });
  hint.textContent = mat.value === 'autre'
    ? 'Pas d\'équivalent ELEGOO : la puce sera codée en PLA.'
    : cur && cur.hidden ? 'Écrit sur la puce, mais la Centauri Carbon 2 ne l\'affiche pas.' : '';
}

function validateWeights() {
  const tot  = document.getElementById('ff-wtot');
  const rem  = document.getElementById('ff-wrem');
  if (!tot || !rem) return;
  const tVal = parseFloat(tot.value) || 0;
  const rVal = parseFloat(rem.value) || 0;
  if (rVal > tVal) {
    rem.style.border = '1.5px solid var(--danger)';
    rem.title = 'Le poids restant ne peut pas dépasser le poids total';
  } else {
    rem.style.border = '';
    rem.title = '';
  }
}

async function saveFilament(id) {
  const body = {
    name:              document.getElementById('ff-name').value,
    brand:             document.getElementById('ff-brand').value,
    material:          document.getElementById('ff-mat').value,
    color_hex:         document.getElementById('ff-color').value,
    color_name:        document.getElementById('ff-colorname').value,
    diameter:          document.getElementById('ff-diam').value,
    weight_total:      document.getElementById('ff-wtot').value,
    weight_remaining:  document.getElementById('ff-wrem').value,
    spool_weight:      document.getElementById('ff-spool').value || null,
    temp_nozzle_min:   document.getElementById('ff-tnmin').value,
    temp_nozzle_max:   document.getElementById('ff-tnmax').value,
    temp_bed_min:      document.getElementById('ff-tbmin').value,
    temp_bed_max:      document.getElementById('ff-tbmax').value,
    price:             document.getElementById('ff-price')?.value || null,
    spool_number:      document.getElementById('ff-spool-num').value || null,
    supplier:          document.getElementById('ff-supplier')?.value || null,
    purchase_date:     document.getElementById('ff-purchase-date')?.value || null,
    elegoo_subtype:    document.getElementById('ff-elegoo-subtype').value || null,
    archived:          document.getElementById('ff-archive-toggle')?.dataset.archived === '1' ? 1 : 0,
    location:          document.getElementById('ff-loc')?.value || '',
    notes:             document.getElementById('ff-notes').value,
    finish_option:     document.getElementById('ff-finish').value !== 'Standard' ? document.getElementById('ff-finish').value : null,
    special_option:    document.getElementById('ff-special').value !== '—' ? document.getElementById('ff-special').value : null,
    parent_filament_id: document.getElementById('ff-parent-id')?.value || null,
    spool_label:       document.getElementById('ff-spool-label')?.value || null,
  };
  if (!body.name) return toast('Le nom est requis', 'error');
  const tot = parseFloat(body.weight_total) || 0;
  const rem = parseFloat(body.weight_remaining) || 0;
  if (rem > tot) return toast('Le poids restant (' + rem + 'g) ne peut pas dépasser le poids total (' + tot + 'g)', 'error');
  try {
    if (id) await API.put('/filaments/'+id, body);
    else    await API.post('/filaments', body);
    closeModal();
    toast(id ? 'Filament mis à jour' : 'Filament ajouté', 'success');
    renderFilaments();
  } catch (e) { toast(e.message, 'error'); }
}

function onParentChange(select) {
  // Pre-remplir matière/couleur depuis le parent si on vient de le sélectionner
  const parentId = parseInt(select.value);
  if (!parentId) return;
  const parent = allFilaments.find(function(f) { return f.id === parentId; });
  if (!parent) return;
  const matSel = document.getElementById('ff-mat');
  const colInp = document.getElementById('ff-color');
  const colName = document.getElementById('ff-colorname');
  if (matSel  && !matSel.value)   matSel.value  = parent.material;
  if (colInp  && colInp.value === '#cccccc') colInp.value = parent.color_hex;
  if (colName && !colName.value)  colName.value = parent.color_name || '';
  toast('Matière et couleur pré-remplies depuis le parent', 'success');
}

function toggleArchiveInForm(el) {
  const isArchived = el.dataset.archived === '1';
  const newState   = !isArchived;
  el.dataset.archived = newState ? '1' : '0';
  const dot   = el.querySelector('div');
  dot.style.left        = newState ? '19px' : '2px';
  el.style.background   = newState ? 'var(--accent)' : 'var(--border2)';
  const label = document.getElementById('ff-archive-label');
  if (label) label.textContent = newState ? 'Bobine archivée' : 'Bobine active';
}

// Archiver/désarchiver rapidement depuis la liste (sans ouvrir le formulaire)
async function quickToggleArchive(id, currentArchived) {
  try {
    const filament = allFilaments.find(f => f.id === id);
    if (!filament) return;
    await API.put('/filaments/' + id, { ...filament, archived: currentArchived ? 0 : 1 });
    toast(currentArchived ? 'Bobine désarchivée' : 'Bobine archivée');
    renderFilaments();
  } catch(e) { toast(e.message, 'error'); }
}

// Écriture ELEGOO depuis la fiche filament
async function openNfcHistory(filamentId) {
  let rows = [];
  try { rows = await API.get('/nfc/history/' + filamentId); } catch(_) {}

  const filament = allFilaments.find(f => f.id === filamentId) || {};

  openModal(
    (rows.length === 0
      ? '<div class="empty-state"><p>Aucune écriture NFC enregistrée pour ce filament.</p></div>'
      : '<table>' +
          '<thead><tr>' +
            '<th>Date</th><th>UID puce</th><th>Format</th><th>Matière</th><th>Sous-type</th>' +
          '</tr></thead>' +
          '<tbody>' +
          rows.map(function(r) {
            return '<tr>' +
              '<td style="font-size:11px;color:#888;white-space:nowrap">' + fmtDateTime(r.written_at) + '</td>' +
              '<td><code style="font-size:11px">' + (r.uid||'—') + '</code></td>' +
              '<td><span style="font-size:11px;padding:2px 7px;background:var(--accent-bg);color:var(--accent);border-radius:10px">' + (r.format||'—') + '</span></td>' +
              '<td style="font-size:12px">' + (r.material||'—') + '</td>' +
              '<td style="font-size:12px;color:var(--text3)">' + (r.subtype||'—') + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody>' +
        '</table>') +
    '<div class="modal-footer"><button class="btn" onclick="closeModal()">Fermer</button></div>',
    'Historique NFC — ' + (filament.name || 'Filament')
  );
}

// Ouvre la modale NFC pré-positionnée sur le filament
async function writeElegooFromFilament(filamentId) {
  // On ouvre la modale NFC avec le filament pré-sélectionné
  // et on déclenche l'écriture dès qu'une carte est détectée
  openNfcScanModal(filamentId);
  // Listener unique : dès qu'une carte arrive, on écrit
  const unsub = nfcOn('card', async (data) => {
    unsub(); // écoute une seule fois
    if (data.filament && data.filament.id === filamentId) {
      // Puce déjà liée à ce filament → écriture directe
      await nfcWriteElegoo(filamentId);
    } else if (!data.filament) {
      // Puce inconnue → proposer de lier d'abord
      toast('Cette puce nest pas liée à ce filament — liez-la dabord.', 'error');
    } else {
      toast('Cette puce appartient à un autre filament.', 'error');
    }
  });
}

async function deleteFilament(id) {
  confirmDelete('Supprimer ce filament ?', async () => {
    try { await API.del('/filaments/'+id); toast('Filament supprimé'); renderFilaments(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

// ── Pesée guidée ──────────────────────────────────────────
async function openWeighingModal(prefillId = null) {
  const filaments = allFilaments.length ? allFilaments : await API.get('/filaments');
  openModal(`
    <div style="margin-bottom:14px;background:var(--bg3);border-radius:var(--radius);
         padding:10px 14px;font-size:13px;color:var(--text2)">
      Posez la bobine <strong>avec le filament</strong> sur la balance, notez le poids brut,
      saisissez-le ci-dessous. L'app soustrait le poids de la bobine vide et met à jour le stock.
    </div>
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">Bobine à peser *</label>
        <select id="wg-filament" onchange="updateWeighingPreview()">
          <option value="">— Sélectionner —</option>
          ${filaments.map(f => `<option value="${f.id}"
            data-spool="${f.spool_weight||0}"
            data-remaining="${f.weight_remaining}"
            ${f.id == prefillId ? 'selected' : ''}>
            ${f.name} · ${Math.round(f.weight_remaining)}g restants
          </option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Poids brut sur balance (g) *</label>
        <input id="wg-gross" type="text" inputmode="decimal" placeholder="ex: 847" oninput="updateWeighingPreview()">
        <div style="font-size:11px;color:var(--text3);margin-top:3px">Point ou virgule acceptés</div>
      </div>
      <div class="form-group">
        <label class="form-label">Poids bobine vide (g)</label>
        <input id="wg-spool" type="text" inputmode="decimal" placeholder="pré-rempli si connu" oninput="updateWeighingPreview()">
        <div style="font-size:11px;color:var(--text3);margin-top:3px">Sera sauvegardé sur la fiche si modifié</div>
      </div>
    </div>
    <div id="weighing-preview" style="display:none;margin:14px 0;background:var(--accent-bg);
         border-radius:var(--radius-lg);padding:14px 16px">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center">
        <div>
          <div style="font-size:11px;color:var(--info,var(--accent));margin-bottom:4px">Poids brut</div>
          <div id="prev-gross" style="font-size:22px;font-weight:500">—</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--info,var(--accent));margin-bottom:4px">Bobine vide</div>
          <div id="prev-spool" style="font-size:22px;font-weight:500">—</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--info,var(--accent));margin-bottom:4px">Filament net</div>
          <div id="prev-net" style="font-size:22px;font-weight:500">—</div>
        </div>
      </div>
      <div id="prev-diff" style="text-align:center;margin-top:10px;font-size:12px;color:var(--text2)"></div>
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label">Notes</label>
      <input id="wg-notes" placeholder="ex: après impression du plateau">
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn btn-primary" onclick="saveWeighing()">Mettre à jour le stock</button>
    </div>
  `, 'Pesée de bobine');

  if (prefillId) updateWeighingPreview();
}

function parseWeight(str) {
  if (!str) return NaN;
  return parseFloat(String(str).replace(',', '.').trim());
}

function updateWeighingPreview() {
  const sel     = document.getElementById('wg-filament');
  const grossEl = document.getElementById('wg-gross');
  const spoolEl = document.getElementById('wg-spool');
  const preview = document.getElementById('weighing-preview');
  if (!sel || !sel.value) { preview.style.display='none'; return; }

  const opt       = sel.options[sel.selectedIndex];
  const defSpool  = parseFloat(opt.dataset.spool) || 0;
  const remaining = parseFloat(opt.dataset.remaining) || 0;

  if (defSpool > 0 && !spoolEl._userEdited) spoolEl.value = String(defSpool).replace('.', ',');
  spoolEl.addEventListener('input', () => { spoolEl._userEdited = true; }, { once: true });

  const gross = parseWeight(grossEl.value);
  const spool = parseWeight(spoolEl.value) || 0;
  if (isNaN(gross)) { preview.style.display='none'; return; }

  const net  = Math.max(0, gross - spool);
  const diff = net - remaining;
  preview.style.display = 'block';
  document.getElementById('prev-gross').textContent = gross.toFixed(0)+'g';
  document.getElementById('prev-spool').textContent = spool > 0 ? spool.toFixed(0)+'g' : '—';
  document.getElementById('prev-net').textContent   = net.toFixed(0)+'g';
  document.getElementById('prev-diff').textContent  =
    `Stock actuel : ${remaining.toFixed(0)}g → ${net.toFixed(0)}g  (${diff>=0?'+':''}${diff.toFixed(0)}g)`;
}

async function saveWeighing(forceConfirm) {
  // Si forceConfirm, utiliser les données mémorisées (formulaire déjà fermé)
  const data = forceConfirm ? window._pendingWeighing : null;

  const filamentId = data ? data.filamentId : document.getElementById('wg-filament')?.value;
  const grossRaw   = data ? data.grossRaw   : document.getElementById('wg-gross')?.value;
  const spoolRaw   = data ? data.spoolRaw   : document.getElementById('wg-spool')?.value;
  const notes      = data ? data.notes      : document.getElementById('wg-notes')?.value;
  const prefillId  = data ? data.prefillId  : (document.getElementById('wg-filament')?.value || null);

  if (!filamentId) return toast('Sélectionnez une bobine', 'error');
  const gross = parseWeight(grossRaw);
  if (isNaN(gross) || gross <= 0) return toast('Poids brut invalide', 'error');

  const filament = allFilaments.find(f => f.id == filamentId);
  const spool    = parseWeight(spoolRaw) || parseFloat(filament?.spool_weight || 0) || 0;
  const net      = Math.max(0, gross - spool);
  const TOLERANCE = 5;

  // ── Vérification cohérence ────────────────────────────────
  if (!forceConfirm) {
    try {
      const history = await API.get('/weighings?filament_id=' + filamentId + '&limit=1');
      let incoherent = false;
      let ctx = {};

      if (history && history.length > 0) {
        const lastNet = parseFloat(history[0].net_weight);
        if (net > lastNet + TOLERANCE) {
          incoherent = true;
          ctx = {
            filamentName: filament?.name || 'bobine #' + filamentId,
            lastNet, newNet: net, diff: net - lastNet, isVsTotal: false,
            lastDate: typeof fmtDateTime === 'function' ? fmtDateTime(history[0].created_at) : history[0].created_at,
          };
        }
      }
      if (!incoherent && filament && net > parseFloat(filament.weight_total || 0) + TOLERANCE) {
        incoherent = true;
        ctx = {
          filamentName: filament.name,
          lastNet: parseFloat(filament.weight_total),
          lastDate: 'poids total de la bobine neuve',
          newNet: net, diff: net - parseFloat(filament.weight_total), isVsTotal: true,
        };
      }

      if (incoherent) {
        // Mémoriser les données AVANT de fermer le formulaire
        window._pendingWeighing = { filamentId, grossRaw, spoolRaw, notes, prefillId };
        openConfirmWeighing(ctx);
        return;
      }
    } catch(_) {}
  }

  // ── Sauvegarde effective ──────────────────────────────────
  window._pendingWeighing = null;
  const spoolOver = parseWeight(spoolRaw);
  try {
    if (!isNaN(spoolOver) && spoolOver > 0) {
      if (filament && spoolOver !== parseFloat(filament.spool_weight || 0)) {
        await API.put('/filaments/' + filamentId, { ...filament, spool_weight: spoolOver });
      }
    }
    const result = await API.post('/weighings', {
      filament_id:  parseInt(filamentId),
      gross_weight: gross,
      notes:        notes || null,
    });
    closeModal();
    toast('Stock mis à jour : ' + parseFloat(result.weighing.net_weight).toFixed(0) + 'g', 'success');
    renderFilaments();
  } catch (e) { toast(e.message, 'error'); }
}

function openConfirmWeighing({ filamentName, lastNet, lastDate, newNet, diff, isVsTotal }) {
  const diffStr = '+' + Math.round(diff) + 'g';
  const label   = isVsTotal ? 'Poids total de la bobine neuve' : 'Dernière pesée';
  const when    = isVsTotal ? '' : '<span style="font-size:11px;color:var(--text3)">(' + lastDate + ')</span>';

  openModal(
    '<div style="text-align:center;margin-bottom:16px">' +
      '<div style="font-size:40px;margin-bottom:8px">⚠️</div>' +
      '<div style="font-size:16px;font-weight:600;color:#f59e0b;margin-bottom:4px">Pesée incohérente</div>' +
      '<div style="font-size:13px;color:var(--text2)">' + filamentName + '</div>' +
    '</div>' +
    '<div style="background:var(--bg3);border-radius:var(--radius);padding:14px;margin-bottom:16px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<span style="font-size:13px;color:var(--text2)">' + label + ' ' + when + '</span>' +
        '<span style="font-size:15px;font-weight:500">' + Math.round(lastNet) + 'g</span>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<span style="font-size:13px;color:var(--text2)">Nouvelle pesée</span>' +
        '<span style="font-size:15px;font-weight:500">' + Math.round(newNet) + 'g</span>' +
      '</div>' +
      '<div style="border-top:0.5px solid var(--border);padding-top:8px;display:flex;justify-content:space-between">' +
        '<span style="font-size:13px;color:var(--text2)">Écart</span>' +
        '<span style="font-size:15px;font-weight:600;color:#ef4444">' + diffStr + '</span>' +
      '</div>' +
    '</div>' +
    '<div style="font-size:13px;color:var(--text2);margin-bottom:16px;text-align:center">' +
      'Un filament ne peut pas augmenter de poids.<br>Vérifiez votre saisie avant de confirmer.' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn" onclick="reopenWeighingForm()">← Corriger la saisie</button>' +
      '<button class="btn btn-danger" onclick="saveWeighing(true)">Confirmer quand même</button>' +
    '</div>',
    '⚠ Vérification pesée'
  );
}

function reopenWeighingForm() {
  const d = window._pendingWeighing;
  if (!d) { closeModal(); return; }
  // Rouvrir le formulaire avec le filament pré-sélectionné
  openWeighingModal(d.prefillId);
  // Restaurer les valeurs après création du DOM
  setTimeout(function() {
    const selEl   = document.getElementById('wg-filament');
    const grossEl = document.getElementById('wg-gross');
    const spoolEl = document.getElementById('wg-spool');
    const notesEl = document.getElementById('wg-notes');
    if (selEl)   { selEl.value   = d.filamentId; }
    if (grossEl) { grossEl.value = d.grossRaw;   }
    if (spoolEl) { spoolEl.value = d.spoolRaw;   }
    if (notesEl) { notesEl.value = d.notes || ''; }
    updateWeighingPreview();
  }, 80);
}

async function openWeighingHistory(filamentId) {
  const fil = allFilaments.find(f => f.id == filamentId);
  const filamentName = fil ? fil.name : 'Filament #' + filamentId;
  try {
    const history = await API.get('/weighings?filament_id=' + filamentId);
    if (!history.length) {
      openModal(
        '<p style="color:var(--text3);font-size:13px;padding:8px 0">Aucune pesée enregistrée pour ce filament.</p>' +
        '<div class="modal-footer"><button class="btn" onclick="closeModal()">Fermer</button></div>',
        'Historique — ' + filamentName);
      return;
    }

    // Données pour le graphique — ordre chronologique
    const chronoHistory = [...history].reverse();
    const labels  = chronoHistory.map(function(w) { return fmtDate(w.created_at); });
    const weights  = chronoHistory.map(function(w) { return parseFloat(w.net_weight).toFixed(0); });
    const maxWeight = fil ? parseFloat(fil.weight_total) : Math.max(...weights.map(Number));

    const totalConsumed = history.reduce(function(sum, w, i) {
      if (i < history.length - 1) {
        const diff = w.previous_weight - history[i+1].previous_weight;
        return sum + Math.max(0, diff);
      }
      return sum;
    }, 0);

    openModal(
      // Graphique
      '<div style="position:relative;height:200px;margin-bottom:16px">' +
        '<canvas id="weigh-chart"></canvas>' +
      '</div>' +
      // Métriques
      '<div style="display:flex;gap:12px;margin-bottom:16px">' +
        '<div class="metric-card" style="flex:1">' +
          '<div class="metric-label">Pesées</div>' +
          '<div class="metric-value">' + history.length + '</div>' +
        '</div>' +
        '<div class="metric-card" style="flex:1">' +
          '<div class="metric-label">Stock actuel</div>' +
          '<div class="metric-value" style="font-size:16px">' + parseFloat(history[0].net_weight).toFixed(0) + 'g</div>' +
          '<div class="metric-sub">' + fmtDateTime(history[0].created_at) + '</div>' +
        '</div>' +
        '<div class="metric-card" style="flex:1">' +
          '<div class="metric-label">Consommé total</div>' +
          '<div class="metric-value" style="font-size:16px">' + totalConsumed.toFixed(0) + 'g</div>' +
        '</div>' +
      '</div>' +
      // Tableau
      '<table>' +
        '<thead><tr>' +
          '<th>Date</th><th>Brut</th><th>Bobine</th><th>Net</th><th>Avant</th><th>Écart</th><th>Notes</th>' +
        '</tr></thead>' +
        '<tbody>' +
        history.map(function(w) {
          const diff = parseFloat(w.net_weight) - parseFloat(w.previous_weight);
          const diffColor = diff > 5 ? '#10b981' : diff < -5 ? '#ef4444' : '#888';
          return '<tr>' +
            '<td style="white-space:nowrap;font-size:12px">' + fmtDateTime(w.created_at) + '</td>' +
            '<td>' + parseFloat(w.gross_weight).toFixed(0) + 'g</td>' +
            '<td style="color:var(--text3)">' + (w.spool_weight ? parseFloat(w.spool_weight).toFixed(0)+'g' : '—') + '</td>' +
            '<td style="font-weight:500">' + parseFloat(w.net_weight).toFixed(0) + 'g</td>' +
            '<td style="color:var(--text3)">' + parseFloat(w.previous_weight).toFixed(0) + 'g</td>' +
            '<td style="color:' + diffColor + ';font-weight:500">' + (diff>=0?'+':'') + diff.toFixed(0) + 'g</td>' +
            '<td style="font-size:12px;color:var(--text3)">' + (w.notes||'—') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody>' +
      '</table>' +
      '<div class="modal-footer">' +
        '<button class="btn" onclick="closeModal()">Fermer</button>' +
        '<button class="btn btn-primary" onclick="closeModal();openWeighingModal(' + filamentId + ')">Nouvelle pesée</button>' +
      '</div>',
      'Évolution stock — ' + filamentName
    );

    // Dessiner le graphique après rendu de la modale
    setTimeout(function() {
      const ctx = document.getElementById('weigh-chart');
      if (!ctx || typeof Chart === 'undefined') return;
      new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Stock restant (g)',
            data: weights,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.08)',
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: '#3b82f6',
            fill: true,
            tension: 0.3,
          }, {
            label: 'Stock total (g)',
            data: labels.map(function() { return maxWeight; }),
            borderColor: 'rgba(100,100,100,0.3)',
            borderDash: [5, 5],
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(ctx) { return ctx.dataset.label + ' : ' + ctx.parsed.y + 'g'; }
              }
            }
          },
          scales: {
            y: {
              min: 0,
              max: Math.ceil(maxWeight * 1.05),
              ticks: { callback: function(v) { return v + 'g'; } }
            }
          }
        }
      });
    }, 100);

  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

// ── Export CSV ────────────────────────────────────────────
function exportFilamentsCSV() {
  const filaments = allFilaments;
  if (!filaments || !filaments.length) return toast('Aucun filament à exporter', 'error');

  const showPrices    = window._showPrices    !== false;
  const showLocations = window._showLocations !== false;

  // En-têtes
  const headers = ['Nom', 'Marque', 'Matière', 'Sous-type', 'Diamètre (mm)', 'Couleur',
    'Poids total (g)', 'Poids restant (g)', 'Stock (%)',
    'Temp. buse min (°C)', 'Temp. buse max (°C)', 'Temp. plateau min (°C)', 'Temp. plateau max (°C)',
    'Notes', 'Archivé'];
  if (showPrices)    headers.splice(8, 0, 'Prix (€)');
  if (showLocations) headers.push('Emplacement');

  const rows = filaments.map(f => {
    const pct = f.weight_total > 0 ? Math.round((f.weight_remaining / f.weight_total) * 100) : '';
    const row = [
      f.name || '',
      f.brand || '',
      f.material || '',
      f.elegoo_subtype || '',
      f.diameter || '1.75',
      f.color_name || f.color_hex || '',
      f.weight_total || '',
      f.weight_remaining || '',
      pct,
      f.temp_nozzle_min || '',
      f.temp_nozzle_max || '',
      f.temp_bed_min || '',
      f.temp_bed_max || '',
      (f.notes || '').replace(/"/g, '""'),
      f.supplier || '',
      f.purchase_date ? f.purchase_date.slice(0,10) : '',
      f.archived ? 'Oui' : 'Non',
    ];
    if (showPrices)    row.splice(8, 0, f.price || '');
    if (showLocations) row.push(f.location || '');
    return row;
  });

  // Construire le CSV
  const csvContent = [headers, ...rows]
    .map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';'))
    .join('\r\n');

  // Télécharger
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0,10);
  a.href     = url;
  a.download = 'filaflow_filaments_' + date + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Export CSV téléchargé', 'success');
}

// ── Export PDF ────────────────────────────────────────────
function exportFilamentsPDF() {
  const filaments = allFilaments;
  if (!filaments || !filaments.length) return toast('Aucun filament à exporter', 'error');
  if (typeof window.jspdf === 'undefined') return toast('jsPDF non chargé', 'error');

  const { jsPDF } = window.jspdf;
  const doc  = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const date = new Date().toLocaleDateString('fr-FR');

  const showPrices    = window._showPrices    !== false;
  const showLocations = window._showLocations !== false;

  // ── En-tête ──
  doc.setFillColor(30, 30, 28);
  doc.rect(0, 0, 297, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('FilaFlow — Inventaire filaments', 14, 13);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Exporté le ' + date + ' — ' + filaments.length + ' bobine(s)', 200, 13);

  // ── Colonnes ──
  const cols = [
    { label: 'Nom',           width: 42, key: 'name' },
    { label: 'Marque',        width: 28, key: 'brand' },
    { label: 'Matière',       width: 20, key: 'material' },
    { label: 'Couleur',       width: 22, key: 'color_name' },
    { label: 'Total (g)',     width: 20, key: 'weight_total' },
    { label: 'Restant (g)',   width: 22, key: 'weight_remaining' },
    { label: 'Stock %',       width: 18, key: '_pct' },
    { label: 'Buse °C',       width: 22, key: '_buse' },
    { label: 'Plateau °C',    width: 22, key: '_plateau' },
  ];
  if (showPrices)    cols.push({ label: 'Prix €', width: 16, key: 'price' });
  if (showLocations) cols.push({ label: 'Emplacement', width: 28, key: 'location' });

  // ── En-tête tableau ──
  let x = 10, y = 28;
  const rowH = 7;
  const headerH = 8;

  doc.setFillColor(245, 245, 243);
  doc.rect(10, y, 277, headerH, 'F');
  doc.setTextColor(80, 80, 75);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');

  cols.forEach(col => {
    doc.text(col.label, x + 2, y + 5.5);
    x += col.width;
  });

  y += headerH;

  // ── Lignes ──
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);

  filaments.forEach((f, i) => {
    if (y > 185) { // Nouvelle page
      doc.addPage();
      y = 15;
      // Ré-afficher l'en-tête tableau
      x = 10;
      doc.setFillColor(245, 245, 243);
      doc.rect(10, y, 277, headerH, 'F');
      doc.setTextColor(80, 80, 75);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      cols.forEach(col => { doc.text(col.label, x + 2, y + 5.5); x += col.width; });
      y += headerH;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
    }

    // Alternance couleur ligne
    if (i % 2 === 0) {
      doc.setFillColor(252, 252, 250);
      doc.rect(10, y, 277, rowH, 'F');
    }

    // Barre de stock colorée
    const pct = f.weight_total > 0 ? Math.round((f.weight_remaining / f.weight_total) * 100) : 0;
    const stockCol = pct <= 10 ? [192, 57, 43] : pct <= 25 ? [230, 126, 34] : [39, 174, 96];

    x = 10;
    doc.setTextColor(30, 30, 28);

    cols.forEach(col => {
      let val = '';
      if (col.key === '_pct') {
        // Mini barre de progression
        doc.setFillColor(220, 220, 218);
        doc.rect(x + 1, y + 2, 14, 3, 'F');
        doc.setFillColor(...stockCol);
        doc.rect(x + 1, y + 2, Math.max(0.5, 14 * pct / 100), 3, 'F');
        doc.setTextColor(...stockCol);
        doc.text(pct + '%', x + 1, y + 5.5 + 0.5);
        doc.setTextColor(30, 30, 28);
      } else if (col.key === '_buse') {
        val = (f.temp_nozzle_min && f.temp_nozzle_max) ? f.temp_nozzle_min + '-' + f.temp_nozzle_max : '—';
        doc.text(String(val), x + 2, y + 5);
      } else if (col.key === '_plateau') {
        val = (f.temp_bed_min && f.temp_bed_max) ? f.temp_bed_min + '-' + f.temp_bed_max : '—';
        doc.text(String(val), x + 2, y + 5);
      } else if (col.key === 'color_name') {
        // Pastille couleur + nom
        if (f.color_hex) {
          const hex = f.color_hex.replace('#','');
          const r = parseInt(hex.substr(0,2),16), g = parseInt(hex.substr(2,2),16), b = parseInt(hex.substr(4,2),16);
          doc.setFillColor(r, g, b);
          doc.circle(x + 3, y + 3.5, 1.8, 'F');
        }
        val = f.color_name || '—';
        doc.text(String(val).substring(0, 14), x + 7, y + 5);
      } else {
        val = f[col.key] != null ? String(f[col.key]) : '—';
        // Tronquer si trop long
        const maxChars = Math.floor(col.width / 2);
        if (val.length > maxChars) val = val.substring(0, maxChars - 1) + '…';
        doc.text(val, x + 2, y + 5);
      }
      x += col.width;
    });

    // Séparateur
    doc.setDrawColor(235, 235, 232);
    doc.line(10, y + rowH, 287, y + rowH);
    y += rowH;
  });

  // ── Pied de page ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 155);
    doc.text('FilaFlow — Page ' + i + ' / ' + pageCount, 14, 205);
  }

  doc.save('filaflow_filaments_' + new Date().toISOString().slice(0,10) + '.pdf');
  toast('Export PDF téléchargé', 'success');
}

// ── Import CSV ────────────────────────────────────────────
function openImportCSV() {
  openModal(
    '<div style="margin-bottom:16px">' +
      '<p style="font-size:13px;color:var(--text2);margin-bottom:12px">' +
        'Le fichier CSV doit utiliser le séparateur <strong>;</strong> et contenir au minimum les colonnes ' +
        '<code>Nom</code> et <code>Matière</code>. Les autres colonnes sont optionnelles.' +
      '</p>' +
      '<p style="font-size:12px;color:var(--text3);margin-bottom:16px">' +
        'Colonnes reconnues : Nom, Marque, Matière, Couleur, Couleur (hex), Diamètre (mm), ' +
        'Poids total (g), Poids restant (g), Temp. buse min, Temp. buse max, ' +
        'Temp. plateau min, Temp. plateau max, Prix (€), Emplacement, Notes.' +
      '</p>' +
      '<input type="file" id="csv-import-file" accept=".csv,.txt" style="margin-bottom:12px">' +
      '<div id="csv-import-preview" style="font-size:12px;color:var(--text3)"></div>' +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px">' +
      '<button class="btn" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" id="btn-do-import" onclick="doImportCSV()" disabled>Importer</button>' +
    '</div>',
    'Importer des filaments (CSV)'
  );

  document.getElementById('csv-import-file').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      const rows = parseCSVRows(ev.target.result);
      const preview = document.getElementById('csv-import-preview');
      const btn     = document.getElementById('btn-do-import');
      if (!rows.length) {
        preview.textContent = 'Aucune ligne valide trouvée.';
        if (btn) btn.disabled = true;
      } else {
        preview.innerHTML = '<strong>' + rows.length + ' filament(s) à importer</strong>' +
          '<br>Exemple : ' + (rows[0].name || '?') + ' · ' + (rows[0].material || '?');
        if (btn) btn.disabled = false;
        window._csvImportRows = rows;
      }
    };
    reader.readAsText(file, 'UTF-8');
  });
}

function parseCSVRows(text) {
  // Supprimer BOM si présent
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(function(l){ return l.trim(); });
  if (lines.length < 2) return [];

  // Détecter séparateur
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(function(h){ return h.replace(/^"|"$/g,'').trim().toLowerCase(); });

  // Mapping des en-têtes
  const MAP = {
    'nom': 'name', 'name': 'name',
    'marque': 'brand', 'brand': 'brand',
    'matière': 'material', 'matiere': 'material', 'material': 'material',
    'couleur': 'color_name', 'color_name': 'color_name',
    'couleur (hex)': 'color_hex', 'color_hex': 'color_hex',
    'diamètre (mm)': 'diameter', 'diameter': 'diameter', 'diametre (mm)': 'diameter',
    'poids total (g)': 'weight_total', 'weight_total': 'weight_total',
    'poids restant (g)': 'weight_remaining', 'weight_remaining': 'weight_remaining',
    'temp. buse min (°c)': 'temp_nozzle_min', 'temp_nozzle_min': 'temp_nozzle_min',
    'temp. buse max (°c)': 'temp_nozzle_max', 'temp_nozzle_max': 'temp_nozzle_max',
    'temp. plateau min (°c)': 'temp_bed_min', 'temp_bed_min': 'temp_bed_min',
    'temp. plateau max (°c)': 'temp_bed_max', 'temp_bed_max': 'temp_bed_max',
    'prix (€)': 'price', 'prix': 'price', 'price': 'price',
    'emplacement': 'location', 'location': 'location',
    'notes': 'notes',
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(sep).map(function(v){ return v.replace(/^"|"$/g,'').trim(); });
    const row  = {};
    headers.forEach(function(h, idx) {
      const key = MAP[h];
      if (key && vals[idx] !== undefined && vals[idx] !== '' && vals[idx] !== '—') {
        row[key] = vals[idx];
      }
    });
    if (row.name && row.material) rows.push(row);
  }
  return rows;
}

async function doImportCSV() {
  const rows = window._csvImportRows;
  if (!rows || !rows.length) return;
  const btn = document.getElementById('btn-do-import');
  if (btn) { btn.disabled = true; btn.textContent = 'Import en cours…'; }
  try {
    const result = await API.post('/filaments/import-csv', { rows });
    closeModal();
    window._csvImportRows = null;
    let msg = result.imported + ' filament(s) importé(s) avec succès.';
    if (result.errors && result.errors.length) {
      msg += ' (' + result.errors.length + ' erreur(s))';
      console.warn('Import CSV errors:', result.errors);
    }
    toast(msg, 'success');
    allFilaments = await API.get('/filaments' + (showArchived ? '?archived=1' : ''));
  window._allFilaments = allFilaments;
    renderFilamentGrid();
  } catch(e) {
    toast('Erreur import : ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Importer'; }
  }
}

// ── QR Code bobine ─────────────────────────────────────────────────────────

// ── Menu déroulant actions filament ──────────────────────────────────────
let _openFilamentMenu = null;

function toggleFilamentMenu(id, btn) {
  const menu = document.getElementById('fmenu-' + id);
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  closeFilamentMenu();
  if (!isOpen) {
    menu.style.display = 'block';
    _openFilamentMenu = id;
    // Fermer si clic ailleurs
    setTimeout(function() {
      document.addEventListener('click', closeFilamentMenuOnClick, { once: true });
    }, 0);
  }
}

function closeFilamentMenu() {
  if (_openFilamentMenu) {
    const menu = document.getElementById('fmenu-' + _openFilamentMenu);
    if (menu) menu.style.display = 'none';
    _openFilamentMenu = null;
  }
}

function closeFilamentMenuOnClick() {
  closeFilamentMenu();
}

// ── Sélecteur poids bobine vide ──────────────────────────────────────────

async function openSpoolWeightPicker() {
  let spoolWeights = [];
  try { spoolWeights = await API.get('/spool-weights'); } catch(_) {}

  // Grouper par fabricant
  const byBrand = {};
  spoolWeights.forEach(function(s) {
    if (!byBrand[s.brand]) byBrand[s.brand] = [];
    byBrand[s.brand].push(s);
  });

  const html =
    '<div style="margin-bottom:12px">' +
      '<input id="spool-picker-search" placeholder="Rechercher fabricant..." ' +
        'oninput="filterSpoolPicker(this.value)" ' +
        'style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius);' +
        'background:var(--bg3);color:var(--text);font-size:13px">' +
    '</div>' +
    '<div id="spool-picker-list" style="max-height:350px;overflow-y:auto">' +
      Object.entries(byBrand).map(function(entry) {
        const brand = entry[0];
        const models = entry[1];
        return '<div class="spool-brand-group" data-brand="' + brand.toLowerCase() + '">' +
          '<div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;' +
            'letter-spacing:0.05em;padding:10px 0 4px;border-top:1px solid var(--border)">' + brand + '</div>' +
          models.map(function(s) {
            return '<div onclick="selectSpoolWeight(' + s.weight_g + ',\'' + brand + ' ' + (s.model||'') + '\')" ' +
              'style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;' +
              'border-radius:var(--radius);cursor:pointer;margin-bottom:2px" ' +
              'onmouseenter="this.style.background=\'var(--bg3)\'" onmouseleave="this.style.background=\'\'">' +
              '<span style="font-size:13px">' + (s.model || 'Standard') +
                (s.spool_size_g ? ' <span style="font-size:11px;color:var(--text3)">(' + s.spool_size_g + 'g)</span>' : '') +
              '</span>' +
              '<span style="font-size:13px;font-weight:600;color:var(--accent)">' + s.weight_g + ' g</span>' +
            '</div>';
          }).join('') +
        '</div>';
      }).join('') +
    '</div>' +
    '<div class="modal-footer" style="margin-top:12px">' +
      '<button class="btn" onclick="closeModal2()">Annuler</button>' +
    '</div>';

  openModal2(html, 'Base de référence — Poids bobines vides');
}

function filterSpoolPicker(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.spool-brand-group').forEach(function(el) {
    el.style.display = !q || el.dataset.brand.includes(q) ? 'block' : 'none';
  });
}

function selectSpoolWeight(weight, label) {
  const input = document.getElementById('ff-spool');
  if (input) {
    input.value = weight;
    input.focus();
  }
  closeModal2();
  toast('Tare appliquée : ' + weight + 'g (' + label.trim() + ')', 'success');
}

// ── Duplication d'un filament ─────────────────────────────────────────────
async function duplicateFilament(id) {
  try {
    const f = await API.get('/filaments/' + id);

    // Préparer la copie — remettre à zéro les champs spécifiques à la bobine
    const copy = Object.assign({}, f, {
      id:            undefined,
      spool_number:  '',           // N° bobine vide
      nfc_uid:       null,         // NFC non lié
      purchase_date: null,         // Date d'achat vide
      weight_remaining: f.weight_total, // Bobine neuve = pleine
      created_at:    undefined,
      updated_at:    undefined,
    });

    // Ouvrir le formulaire avec les données pré-remplies
    // On passe null comme id (nouveau) mais on pré-remplit via _duplicateSource
    window._duplicateSource = copy;
    openFilamentForm(null, null, copy);

  } catch(e) { toast('Erreur : ' + e.message, 'error'); }
}

function openFilamentQR(id) {
  const f = allFilaments.find(function(x) { return x.id === id; });
  if (!f) return;

  // URL qui ouvre directement la fiche filament dans FilaFlow
  const url = window.location.origin + '/#filament/' + id;

  const pct = f.weight_total > 0 ? Math.round(f.weight_remaining / f.weight_total * 100) : 0;
  const barColor = pct < 15 ? '#ef4444' : pct < 25 ? '#f59e0b' : '#10b981';

  const optLabel = [
    f.finish_option && f.finish_option !== 'Standard' ? f.finish_option : null,
    f.special_option && f.special_option !== '—'      ? f.special_option : null,
  ].filter(Boolean).join(' · ');

  openModal(`
    <div style="display:flex;gap:24px;align-items:flex-start">

      <!-- QR Code -->
      <div style="flex-shrink:0;text-align:center">
        <div id="qr-container" style="background:#fff;padding:12px;border-radius:var(--radius);
          border:0.5px solid var(--border2);display:inline-block"></div>
        <div style="font-size:10px;color:var(--text3);margin-top:6px">Scanner pour ouvrir la fiche</div>
      </div>

      <!-- Infos bobine -->
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span style="width:18px;height:18px;border-radius:50%;background:${f.color_hex||'#ccc'};
            flex-shrink:0;display:inline-block;border:1px solid rgba(0,0,0,0.1)"></span>
          <span style="font-size:16px;font-weight:600">${f.name}</span>
        </div>

        <table style="width:100%;font-size:13px;border-collapse:collapse">
          ${f.brand ? `<tr><td style="color:var(--text3);padding:4px 0;width:40%">Marque</td><td style="font-weight:500">${f.brand}</td></tr>` : ''}
          <tr><td style="color:var(--text3);padding:4px 0">Matière</td>
            <td style="font-weight:500">${f.material}${f.elegoo_subtype ? ' · '+f.elegoo_subtype : ''}${optLabel ? ' · '+optLabel : ''}</td></tr>
          ${f.color_name ? `<tr><td style="color:var(--text3);padding:4px 0">Couleur</td><td>${f.color_name}</td></tr>` : ''}
          <tr><td style="color:var(--text3);padding:4px 0">Diamètre</td><td>${f.diameter||1.75} mm</td></tr>
          <tr><td style="color:var(--text3);padding:4px 0">Stock</td>
            <td>
              <span style="font-weight:500">${Math.round(f.weight_remaining)}g</span>
              <span style="color:var(--text3)"> / ${f.weight_total}g</span>
              <span style="margin-left:6px;font-size:11px;color:${barColor};font-weight:600">(${pct}%)</span>
            </td></tr>
          <tr><td style="color:var(--text3);padding:4px 0">Buse</td>
            <td>${f.temp_nozzle_min||'—'}–${f.temp_nozzle_max||'—'} °C</td></tr>
          <tr><td style="color:var(--text3);padding:4px 0">Plateau</td>
            <td>${f.temp_bed_min||'—'}–${f.temp_bed_max||'—'} °C</td></tr>
          ${f.spool_number ? `<tr><td style="color:var(--text3);padding:4px 0">N° bobine</td><td>${f.spool_number}</td></tr>` : ''}
          ${f.location ? `<tr><td style="color:var(--text3);padding:4px 0">Emplacement</td><td>${f.location}</td></tr>` : ''}
        </table>
      </div>
    </div>

    <div class="modal-footer" style="margin-top:16px">
      <button class="btn" onclick="closeModal()">Fermer</button>
      <button class="btn btn-sm" onclick="printFilamentLabel(${id})"
        style="background:var(--bg3);border:0.5px solid var(--border2)">🖨 Imprimer l'étiquette</button>
    </div>
  `, 'QR Code — ' + f.name);

  // Générer le QR code après l'ouverture de la modale
  setTimeout(function() {
    const container = document.getElementById('qr-container');
    if (!container) return;
    try {
      new QRCode(container, {
        text:           url,
        width:          150,
        height:         150,
        colorDark:      '#000000',
        colorLight:     '#ffffff',
        correctLevel:   QRCode.CorrectLevel.M,
      });
    } catch(e) {
      container.innerHTML = '<div style="font-size:11px;color:var(--danger)">QR Code indisponible</div>';
    }
  }, 100);
}

function printFilamentLabel(id) {
  const f = allFilaments.find(function(x) { return x.id === id; });
  if (!f) return;

  const url    = window.location.origin + '/#filament/' + id;
  const pct    = f.weight_total > 0 ? Math.round(f.weight_remaining / f.weight_total * 100) : 0;
  const optLabel = [
    f.finish_option && f.finish_option !== 'Standard' ? f.finish_option : null,
    f.special_option && f.special_option !== '—'      ? f.special_option : null,
  ].filter(Boolean).join(' · ');

  const win = window.open('', '_blank', 'width=400,height=300');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>Étiquette — ${f.name}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <style>
      * { margin:0;padding:0;box-sizing:border-box }
      body { font-family:system-ui,sans-serif;padding:16px;background:#fff;color:#000 }
      .label { display:flex;gap:14px;align-items:center;
               border:1.5px solid #000;border-radius:6px;padding:12px;
               width:fit-content;min-width:240px }
      .qr { flex-shrink:0 }
      .info { flex:1 }
      .name { font-size:14px;font-weight:700;margin-bottom:6px }
      .dot  { width:12px;height:12px;border-radius:50%;background:${f.color_hex||'#ccc'};
               display:inline-block;margin-right:6px;vertical-align:middle;
               border:1px solid rgba(0,0,0,0.15) }
      .row  { font-size:11px;margin-bottom:2px;color:#333 }
      .row strong { color:#000 }
      .stock-bar { height:4px;background:#eee;border-radius:2px;margin-top:4px }
      .stock-fill { height:100%;border-radius:2px;
                    background:${pct < 15 ? '#ef4444' : pct < 25 ? '#f59e0b' : '#10b981'};
                    width:${pct}% }
      @media print {
        body { padding:4px }
        @page { margin:4mm }
      }
    </style>
  </head><body>
    <div class="label">
      <div class="qr" id="qr"></div>
      <div class="info">
        <div class="name"><span class="dot"></span>${f.name}</div>
        ${f.brand ? `<div class="row"><strong>${f.brand}</strong></div>` : ''}
        <div class="row">${f.material}${f.elegoo_subtype ? ' · '+f.elegoo_subtype : ''}${optLabel ? ' · '+optLabel : ''} — ${f.diameter||1.75}mm</div>
        <div class="row">🌡 Buse ${f.temp_nozzle_min}–${f.temp_nozzle_max}°C · Plateau ${f.temp_bed_min}–${f.temp_bed_max}°C</div>
        <div class="row" style="margin-top:4px">
          Stock : <strong>${Math.round(f.weight_remaining)}g / ${f.weight_total}g (${pct}%)</strong>
        </div>
        <div class="stock-bar"><div class="stock-fill"></div></div>
        ${f.spool_number ? `<div class="row" style="margin-top:4px">N° ${f.spool_number}</div>` : ''}
        ${f.location ? `<div class="row">📍 ${f.location}</div>` : ''}
      </div>
    </div>
    <script>
      new QRCode(document.getElementById('qr'), {
        text: '${url}', width:90, height:90,
        colorDark:'#000', colorLight:'#fff', correctLevel:QRCode.CorrectLevel.M
      });
      setTimeout(function(){ window.print(); }, 500);
    <\/script>
  </body></html>`);
  win.document.close();
}
