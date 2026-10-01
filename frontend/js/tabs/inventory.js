// ── Inventaire des bobines ──────────────────────────────────────────────
// Sous-vue de l'onglet Filaments (menu Outils › Inventaire) : bobines dont le poids
// est à vérifier (pesée ancienne, valeurs incohérentes, données manquantes).
// Les règles sont calculées côté serveur : backend/routes/inventory.js

let _inventoryOpen = false;

const INV_GROUPS = [
  { key: 'incoherence', title: 'Valeurs incohérentes', hint: 'À peser en priorité : le poids enregistré est probablement faux.' },
  { key: 'donnees',     title: 'Données à compléter',  hint: 'À corriger sur la fiche de la bobine.' },
  { key: 'age',         title: 'Pesées anciennes',      hint: 'À peser, ou à confirmer si le poids est toujours bon.' },
];
const INV_BADGE = { incoherence: 'badge-danger', donnees: 'badge-warning', age: 'badge-neutral' };

function openInventory() {
  _inventoryOpen = true;
  renderFilaments();
}
function closeInventory() {
  _inventoryOpen = false;
  renderFilaments();
}

// Compteur sur le bouton Outils et dans son menu
async function refreshInventoryBadge() {
  try {
    const r = await API.get('/inventory/count');
    const n = r.enabled ? r.count : 0;
    const badge = document.getElementById('inv-count-badge');
    const menu  = document.getElementById('inv-count-menu');
    if (badge) { badge.textContent = n ? ' · ' + n : ''; badge.title = n ? n + ' bobine(s) à vérifier' : ''; }
    if (menu)  menu.textContent = n ? ' (' + n + ')' : '';
    const item = document.getElementById('inv-menu-item');
    if (item) item.style.display = r.enabled ? '' : 'none';
  } catch (_) {}
}

function invDate(str) {
  if (!str) return 'Jamais';
  const d = new Date(String(str).replace(' ', 'T'));
  if (isNaN(d)) return 'Jamais';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function invSpoolName(f) {
  return escHtml(f.name) +
    (f.spool_number ? ' <span style="color:var(--text3)">(' + escHtml(f.spool_number) + ')</span>' : '') +
    (f.spool_label ? ' <span style="color:var(--text3)">· ' + escHtml(f.spool_label) + '</span>' : '');
}

function invRowHtml(f) {
  const codes = f.reasons.map(function(r) { return r.code; });
  const actions = [
    '<button class="btn btn-sm btn-primary" onclick="inventoryWeigh(' + f.id + ')">Peser</button>',
    f.can_confirm ? '<button class="btn btn-sm" onclick="inventoryConfirm(' + f.id + ')" title="Le poids enregistré est bon : valider sans peser">Confirmer</button>' : '',
    (codes.includes('no_tare') || codes.includes('over_full')) ? '<button class="btn btn-sm" onclick="openFilamentForm(' + f.id + ')">Fiche</button>' : '',
    codes.includes('empty_active') ? '<button class="btn btn-sm" onclick="quickToggleArchive(' + f.id + ', 0)">Archiver</button>' : '',
  ].join('');
  const reasons = f.reasons.map(function(r) {
    return '<div style="margin-bottom:3px"><span class="badge ' + INV_BADGE[r.group] + '">' + escHtml(r.label) + '</span>' +
      ' <span style="font-size:12px;color:var(--text3)">' + escHtml(r.detail || '') + '</span></div>';
  }).join('');
  return '<tr>' +
    '<td><div style="display:flex;align-items:center;gap:8px">' +
      '<span class="filament-dot" style="background:' + escHtml(f.color_hex || '#ccc') + ';width:14px;height:14px;flex-shrink:0"></span>' +
      '<div><div style="font-weight:500">' + invSpoolName(f) + '</div>' +
      '<div style="font-size:11px;color:var(--text3)">' + escHtml([f.material, f.brand].filter(Boolean).join(' · ')) + '</div></div>' +
    '</div></td>' +
    (window._showLocations ? '<td style="font-size:12px;color:var(--text2)">' + escHtml(f.location || '—') + '</td>' : '') +
    '<td style="white-space:nowrap"><span style="font-weight:500">' + Math.round(parseFloat(f.weight_remaining) || 0) + 'g</span>' +
      '<span style="color:var(--text3);font-size:11px"> / ' + Math.round(parseFloat(f.weight_total) || 0) + 'g</span></td>' +
    '<td style="font-size:12px;color:var(--text2);white-space:nowrap">' + invDate(f.last_weighed_at) + '</td>' +
    '<td>' + reasons + '</td>' +
    '<td><div class="td-actions" style="justify-content:flex-end">' + actions + '</div></td>' +
  '</tr>';
}

async function renderInventory() {
  document.getElementById('page-title').textContent = 'Inventaire';
  document.getElementById('topbar-actions').innerHTML =
    '<button type="button" class="btn" onclick="closeInventory()">← Bobines</button>' +
    '<button type="button" class="btn btn-primary hide-sm" onclick="openWeighingModal()">Pesée</button>';
  const content = document.getElementById('content');
  content.innerHTML = '<div style="color:var(--text3);padding:20px 0">Chargement…</div>';

  let inv;
  try {
    const both = await Promise.all([API.get('/inventory'), API.get('/filaments')]);
    inv = both[0];
    allFilaments = both[1];            // utilisé par la pesée et l'archivage
    window._allFilaments = allFilaments;
  } catch (e) {
    content.innerHTML = '<div class="empty-state"><p>' + escHtml(e.message) + '</p></div>';
    return;
  }
  const s = inv.settings;

  if (!s.enabled) {
    content.innerHTML = '<div class="card"><p style="font-size:13px;color:var(--text2)">L\'inventaire est désactivé. ' +
      'Activez-le dans <a href="#" onclick="event.preventDefault();switchTab(\'settings\')">Paramètres › Apparence</a>.</p></div>';
    return;
  }

  const intro = '<div class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
    '<div style="flex:1;min-width:240px">' +
      '<div style="font-size:15px;font-weight:600">' + (inv.count
        ? inv.count + ' bobine' + (inv.count > 1 ? 's' : '') + ' à vérifier'
        : 'Toutes les bobines sont à jour') + '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:2px">Pesée considérée ancienne après ' + s.days +
        ' jours · tolérance ' + s.tolerance + ' g · ' +
        '<a href="#" onclick="event.preventDefault();switchTab(\'settings\')">modifier</a></div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--text3);max-width:420px">« Confirmer » valide le poids sans pesée et remet le délai à zéro. ' +
      'Il n\'apparaît pas dans l\'historique des pesées, seulement dans le journal.</div>' +
  '</div>';

  if (!inv.count) { content.innerHTML = intro; return; }

  const groupOf = function(f) { return INV_GROUPS[f.rank].key; };
  const head = '<thead><tr><th>Bobine</th>' + (window._showLocations ? '<th>Emplacement</th>' : '') +
    '<th>Poids</th><th>Dernière pesée</th><th>Motif</th><th style="text-align:right">Actions</th></tr></thead>';

  content.innerHTML = intro + INV_GROUPS.map(function(g) {
    const rows = inv.items.filter(function(f) { return groupOf(f) === g.key; });
    if (!rows.length) return '';
    return '<div class="card">' +
      '<div class="card-header"><span class="card-title">' + g.title + ' · ' + rows.length + '</span></div>' +
      '<p style="font-size:12px;color:var(--text3);margin:-4px 0 10px">' + g.hint + '</p>' +
      '<div style="overflow-x:auto"><table>' + head + '<tbody>' + rows.map(invRowHtml).join('') + '</tbody></table></div>' +
    '</div>';
  }).join('');
}

// Pesée habituelle, avec la note « Inventaire » pré-remplie
async function inventoryWeigh(id) {
  await openWeighingModal(id);
  const notes = document.getElementById('wg-notes');
  if (notes && !notes.value) notes.value = 'Inventaire';
}

async function inventoryConfirm(id) {
  try {
    await API.post('/inventory/' + id + '/confirm', {});
    toast('Poids confirmé', 'success');
    renderFilaments();
  } catch (e) { toast(e.message, 'error'); }
}
