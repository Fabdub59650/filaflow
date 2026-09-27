/**
 * nfc.js — Module NFC frontend
 * - Connexion SSE au démon NFC
 * - Widget de scan rapide dans la topbar
 * - Fonctions d'aide pour la fiche filament
 */

let _nfcEventSource  = null;
let _nfcStatus       = { available: false, lastCard: null };
let _nfcListeners    = {};   // { event: [callbacks] }
let _scanModalActive = false;

// ── Connexion SSE ─────────────────────────────────────────
function nfcConnect() {
  if (_nfcEventSource) return;
  _nfcEventSource = new EventSource('/api/nfc/events');

  _nfcEventSource.addEventListener('status', e => {
    const data = JSON.parse(e.data);
    _nfcStatus = { ...data };
    _updateNfcIndicator();
    _updateNfcSidebarBadge();
    _dispatch('status', data);
  });

  _nfcEventSource.addEventListener('card', e => {
    const data = JSON.parse(e.data);
    _nfcStatus.lastCard = data;
    _dispatch('card', data);
    _handleCardDetected(data);
  });

  _nfcEventSource.addEventListener('card_removed', () => {
    _nfcStatus.lastCard = null;
    _dispatch('card_removed', {});
  });

  _nfcEventSource.addEventListener('linked', e => {
    _dispatch('linked', JSON.parse(e.data));
  });

  _nfcEventSource.onerror = () => {
    _nfcStatus.available = false;
    _updateNfcIndicator();
    _updateNfcSidebarBadge();
    // Reconnexion auto dans 5s
    setTimeout(() => {
      _nfcEventSource = null;
      nfcConnect();
    }, 5000);
  };
}

// ── Dispatch interne ──────────────────────────────────────
function _dispatch(event, data) {
  (_nfcListeners[event] || []).forEach(cb => { try { cb(data); } catch(_) {} });
}

function nfcOn(event, cb) {
  if (!_nfcListeners[event]) _nfcListeners[event] = [];
  _nfcListeners[event].push(cb);
  return () => { _nfcListeners[event] = _nfcListeners[event].filter(c => c !== cb); };
}

// ── Indicateur NFC dans la topbar ─────────────────────────
function _updateNfcSidebarBadge() {
  const badge = document.getElementById('nfc-sidebar-badge');
  if (!badge) return;
  const sub = document.getElementById('nfc-sidebar-sub');
  if (_nfcStatus.available) {
    badge.className = 'spoolman-status online';
    if (sub) sub.textContent = 'ACR122U · prêt';
  } else {
    badge.className = 'spoolman-status offline';
    if (sub) sub.textContent = 'Non détecté';
  }
}

function _updateNfcIndicator() {
  const el = document.getElementById('nfc-indicator');
  if (!el) return;
  if (_nfcStatus.available) {
    el.style.background = 'var(--success)';
    el.title = 'Lecteur NFC connecté';
  } else {
    el.style.background = 'var(--text3)';
    el.title = 'Lecteur NFC non disponible';
  }
}

// Injecter l'indicateur NFC dans le header au démarrage
function nfcInjectIndicator() {
  const nav = document.querySelector('.topbar') || document.querySelector('header');
  if (!nav || document.getElementById('nfc-indicator-wrap')) return;

  const wrap = document.createElement('div');
  wrap.id    = 'nfc-indicator-wrap';
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:auto;padding-right:12px';
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;cursor:pointer"
         onclick="openNfcScanModal()" title="Scanner une bobine">
      <div id="nfc-indicator" style="width:8px;height:8px;border-radius:50%;
           background:var(--text3);transition:background 0.3s"></div>
      <span style="font-size:11px;color:var(--text2);font-weight:500">NFC</span>
    </div>`;
  nav.appendChild(wrap);
  _updateNfcIndicator();
}

// ── Gestion d'une carte détectée ──────────────────────────
function _handleCardDetected(data) {
  // Pré-remplir le formulaire d'impression si un filament est lié
  if (data.filament && typeof window._nfcPrefillCallback === 'function') {
    window._nfcPrefillCallback(data.filament);
    window._nfcPrefillCallback = null;
    return; // ne pas ouvrir la modale scan
  }
  // Si un modal de scan est actif, mettre à jour son contenu
  if (_scanModalActive) {
    _updateScanModal(data);
    return;
  }

  // Si un filament connu → proposer la pesée
  if (data.filament) {
    _showQuickScanToast(data.filament);
  }
}

function _showQuickScanToast(filament) {
  // Toast persistant avec actions
  const toastId = 'nfc-toast-' + Date.now();
  const div = document.createElement('div');
  div.id    = toastId;
  div.style.cssText = `position:fixed;bottom:80px;right:20px;z-index:9999;
    background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--radius-lg);
    padding:14px 16px;box-shadow:0 4px 20px rgba(0,0,0,0.15);min-width:260px;
    animation:slideIn 0.2s ease`;
  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <span style="font-size:18px">📡</span>
      <div>
        <div style="font-size:13px;font-weight:500">${filament.name}</div>
        <div style="font-size:11px;color:var(--text3)">${filament.material} · ${Math.round(filament.weight_remaining)}g restants</div>
      </div>
      <button onclick="document.getElementById('${toastId}').remove()"
              style="margin-left:auto;background:none;border:none;cursor:pointer;
                     color:var(--text3);font-size:16px">✕</button>
    </div>
    <div style="display:flex;gap:6px">
      <button class="btn btn-sm btn-primary" onclick="openWeighingModal(${filament.id});document.getElementById('${toastId}').remove()">
        ⚖ Peser
      </button>
      <button class="btn btn-sm" onclick="nfcGoToFilament(${filament.id});document.getElementById('${toastId}').remove()">
        Voir la fiche
      </button>
      <button class="btn btn-sm" onclick="document.getElementById('${toastId}').remove()">
        Ignorer
      </button>
    </div>`;
  document.body.appendChild(div);
  // Auto-fermeture après 10s
  setTimeout(() => { if (document.getElementById(toastId)) div.remove(); }, 10000);
}

// ── Modal de scan rapide ──────────────────────────────────
async function openNfcScanModal(prefillFilamentId = null) {
  _scanModalActive = true;

  openModal(`
    <div style="text-align:center;padding:8px 0 20px">
      <div id="nfc-scan-icon" style="font-size:48px;margin-bottom:12px">📡</div>
      <div id="nfc-scan-status" style="font-size:14px;font-weight:500;margin-bottom:6px">
        ${_nfcStatus.available ? 'Posez la bobine sur le lecteur…' : 'Lecteur NFC non disponible'}
      </div>
      <div id="nfc-scan-uid" style="font-size:11px;color:var(--text3);font-family:monospace"></div>
    </div>

    <div id="nfc-scan-result" style="display:none"></div>

    ${prefillFilamentId ? `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:10px;margin-bottom:14px;font-size:12px;color:var(--text2)">
      Mode liaison : la prochaine puce scannée sera liée à ce filament.
    </div>` : ''}

    <div id="nfc-scan-actions" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:8px">
      ${_nfcStatus.lastCard ? `
      <button class="btn btn-sm" onclick="nfcReadCurrentCard()">Lire les données</button>
      ${prefillFilamentId ? `
      <button class="btn btn-sm btn-primary" onclick="nfcLinkToFilament(${prefillFilamentId})">
        Lier cette puce
      </button>` : ''}` : ''}
    </div>

    <div class="modal-footer">
      <button class="btn" onclick="_scanModalActive=false;closeModal()">Fermer</button>
    </div>
  `, 'Scanner NFC');

  // Si une carte est déjà présente, afficher son info
  if (_nfcStatus.lastCard) {
    _updateScanModal(_nfcStatus.lastCard, prefillFilamentId);
  }

  // Stocker prefillFilamentId pour utilisation dans les callbacks
  window._nfcPrefillFilamentId = prefillFilamentId;
}

function _updateScanModal(data, prefillFilamentId) {
  const fid = prefillFilamentId || window._nfcPrefillFilamentId;
  const icon   = document.getElementById('nfc-scan-icon');
  const status = document.getElementById('nfc-scan-status');
  const uid    = document.getElementById('nfc-scan-uid');
  const result = document.getElementById('nfc-scan-result');
  const actions= document.getElementById('nfc-scan-actions');
  if (!icon) return;

  icon.textContent = '✅';
  uid.textContent  = 'UID : ' + data.uid;

  if (data.filament) {
    const f = data.filament;
    const p = f.weight_total > 0 ? Math.round((f.weight_remaining / f.weight_total) * 100) : 0;
    const barCol = p < 15 ? 'var(--danger)' : p < 30 ? 'var(--warning)' : 'var(--accent)';
    status.textContent = 'Bobine identifiée';
    result.style.display = 'block';
    result.innerHTML =
      '<div style="background:var(--bg3);border-radius:var(--radius-lg);padding:14px;margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
          '<span class="filament-dot" style="background:' + f.color_hex + ';width:18px;height:18px;flex-shrink:0"></span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:14px;font-weight:600">' + f.name + '</div>' +
            '<div style="font-size:12px;color:var(--text3)">' + f.material +
              (f.brand ? ' · ' + f.brand : '') +
              (f.color_name ? ' · ' + f.color_name : '') +
            '</div>' +
          '</div>' +
          '<button class="btn btn-sm" onclick="_scanModalActive=false;closeModal();nfcGoToFilament(' + f.id + ')" ' +
            'style="flex-shrink:0">Fiche ↗</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;margin-bottom:12px">' +
          '<div style="background:var(--bg2);border-radius:var(--radius);padding:8px">' +
            '<div style="color:var(--text3);margin-bottom:2px">Stock restant</div>' +
            '<div style="font-weight:600;font-size:14px">' + Math.round(f.weight_remaining) + 'g</div>' +
            '<div style="color:var(--text3);font-size:11px">/ ' + f.weight_total + 'g total</div>' +
          '</div>' +
          '<div style="background:var(--bg2);border-radius:var(--radius);padding:8px">' +
            '<div style="color:var(--text3);margin-bottom:2px">Progression</div>' +
            '<div style="font-weight:600;font-size:14px;color:' + barCol + '">' + p + '%</div>' +
            '<div class="progress-wrap" style="height:4px;margin-top:4px">' +
              '<div class="progress-fill" style="width:' + p + '%;background:' + barCol + '"></div>' +
            '</div>' +
          '</div>' +
          (f.temp_nozzle_min ? '<div style="background:var(--bg2);border-radius:var(--radius);padding:8px">' +
            '<div style="color:var(--text3);margin-bottom:2px">Buse</div>' +
            '<div style="font-weight:500">' + f.temp_nozzle_min + '–' + f.temp_nozzle_max + '°C</div>' +
          '</div>' : '') +
          (f.temp_bed_min ? '<div style="background:var(--bg2);border-radius:var(--radius);padding:8px">' +
            '<div style="color:var(--text3);margin-bottom:2px">Plateau</div>' +
            '<div style="font-weight:500">' + f.temp_bed_min + '–' + f.temp_bed_max + '°C</div>' +
          '</div>' : '') +
        '</div>' +
        (f.notes ? '<div style="font-size:11px;color:var(--text3);border-top:0.5px solid var(--border);padding-top:8px">' + f.notes + '</div>' : '') +
      '</div>';
    actions.innerHTML =
      '<button class="btn btn-sm btn-primary" onclick="_scanModalActive=false;closeModal();openWeighingModal(' + f.id + ')">⚖ Peser</button>' +
      '<button class="btn btn-sm" onclick="nfcWriteToCard(' + f.id + ')">✍ Écrire FilaFlow</button>' +
      '<button class="btn btn-sm" onclick="nfcWriteElegoo(' + f.id + ')" style="background:var(--accent-bg);color:var(--accent);font-weight:500">◈ Écrire ELEGOO</button>' +
      '<button class="btn btn-sm" onclick="nfcDumpPages()" title="Lire les bytes bruts pages 16-24">🔍 Dump</button>' +
      '<button class="btn btn-sm btn-danger" onclick="nfcUnlinkFilament(' + f.id + ')">Délier</button>';
  } else {
    status.textContent = 'Puce inconnue — non liée';
    result.style.display = 'none';
    actions.innerHTML = fid
      ? `<button class="btn btn-sm btn-primary" onclick="nfcLinkToFilament(${fid})">Lier à ce filament</button>
         <button class="btn btn-sm" onclick="openNfcLinkPicker()">Lier à un autre filament</button>`
      : `<button class="btn btn-sm btn-primary" onclick="openNfcLinkPicker()">Lier à un filament</button>
         <button class="btn btn-sm" onclick="nfcReadCurrentCard()">Lire les données</button>`;
  }
}

// ── Navigation vers la fiche filament ────────────────────
async function nfcGoToFilament(filamentId) {
  // Changer d'onglet
  switchTab('filaments');
  // Attendre que renderFilaments ait chargé les données et le DOM
  const tryOpen = (attempts) => {
    // openFilamentForm est défini dans filaments.js et attend allFilaments chargé
    if (typeof openFilamentForm === 'function' && typeof allFilaments !== 'undefined' && allFilaments.length > 0) {
      openFilamentForm(filamentId);
    } else if (attempts > 0) {
      setTimeout(() => tryOpen(attempts - 1), 200);
    }
  };
  setTimeout(() => tryOpen(10), 300);
}

// ── Actions NFC ───────────────────────────────────────────
async function nfcLinkToFilament(filamentId) {
  try {
    const r = await API.post('/nfc/link', { filament_id: filamentId });
    toast('Puce liée au filament ✓', 'success');
    _scanModalActive = false;
    closeModal();
    if (typeof renderFilaments === 'function') renderFilaments();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

async function nfcUnlinkFilament(filamentId) {
  try {
    await API.del('/nfc/link/' + filamentId);
    toast('Puce déliée');
    _scanModalActive = false;
    closeModal();
    if (typeof renderFilaments === 'function') renderFilaments();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

async function nfcWriteToCard(filamentId) {
  try {
    toast('Écriture en cours…');
    const r = await API.post('/nfc/write', { filament_id: filamentId });
    toast('Données écrites sur la puce ✓', 'success');
  } catch (e) { toast('Erreur écriture : ' + e.message, 'error'); }
}

// Activer le mode pré-remplissage : next scan → callback
function nfcWaitForFilament(callback) {
  window._nfcPrefillCallback = callback;
  toast('Posez la bobine sur le lecteur pour pré-remplir le filament…');
}

async function nfcDumpPages() {
  const result = document.getElementById('nfc-scan-result');
  if (result) result.innerHTML = '<span style="color:var(--text3);font-size:13px">Lecture en cours…</span>';
  try {
    const r = await API.get('/nfc/dump');
    const rows = r.pages.map(p => {
      const ascii = p.bytes.map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
      return '<tr>' +
        '<td style="font-family:monospace;color:var(--text3);font-size:11px">p' + p.page + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + p.hex + '</td>' +
        '<td style="font-family:monospace;font-size:11px;color:var(--text3)">' + ascii + '</td>' +
        '</tr>';
    }).join('');
    if (result) result.innerHTML =
      '<div style="margin-top:8px">' +
        '<div style="font-size:11px;font-weight:500;color:var(--text3);margin-bottom:4px">UID: ' + r.uid + ' — Pages 16-24 :</div>' +
        '<table style="font-size:11px;width:100%">' +
          '<thead><tr><th style="text-align:left">Page</th><th style="text-align:left">Hex</th><th style="text-align:left">ASCII</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';
  } catch(e) {
    if (result) result.innerHTML = '<span style="color:var(--danger);font-size:13px">Erreur : ' + e.message + '</span>';
  }
}

async function nfcWriteElegoo(filamentId) {
  // Afficher progression
  const actions = document.getElementById('nfc-scan-actions');
  if (actions) {
    actions.innerHTML = '<span style="font-size:13px;color:var(--text3)">Écriture format ELEGOO en cours…</span>';
  }
  try {
    const r = await API.post('/nfc/write-elegoo', { filament_id: filamentId });
    // Afficher résultat
    const result = document.getElementById('nfc-scan-result');
    if (result) {
      result.style.display = 'block';
      result.innerHTML = `
        <div style="background:var(--accent-bg);border-radius:var(--radius-lg);padding:12px;margin-bottom:8px">
          <div style="font-size:13px;font-weight:500;color:var(--accent);margin-bottom:6px">
            ✓ Format ELEGOO écrit — ${r.pages_written} pages
          </div>
          <div style="font-size:11px;color:var(--text2)">
            La bobine est maintenant reconnue par la Centauri Carbon 2 Combo.
          </div>
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
            ${r.details.map(d =>
              '<span style="font-size:10px;padding:2px 6px;border-radius:4px;' +
              'background:' + (d.ok ? 'var(--success-bg)' : 'var(--danger-bg)') + ';' +
              'color:' + (d.ok ? 'var(--success)' : 'var(--danger)') + '">' +
              'p' + d.page + (d.ok ? ' ✓' : ' ✗') + '</span>'
            ).join('')}
          </div>
        </div>`;
    }
    toast('Format ELEGOO écrit — ' + r.pages_written + ' pages ✓', 'success');
    // Restaurer les boutons
    const card = _nfcStatus.lastCard;
    if (actions && card && card.filament) {
      const f = card.filament;
      actions.innerHTML =
        '<button class="btn btn-sm btn-primary" onclick="_scanModalActive=false;closeModal();openWeighingModal(' + f.id + ')">⚖ Peser</button>' +
        '<button class="btn btn-sm" onclick="nfcWriteToCard(' + f.id + ')">✍ Écrire FilaFlow</button>' +
        '<button class="btn btn-sm" onclick="nfcWriteElegoo(' + f.id + ')" style="background:var(--accent-bg);color:var(--accent);font-weight:500">◈ Écrire ELEGOO</button>' +
        '<button class="btn btn-sm btn-danger" onclick="nfcUnlinkFilament(' + f.id + ')">Délier</button>';
    }
  } catch (e) {
    toast('Erreur écriture ELEGOO : ' + e.message, 'error');
    if (actions) actions.innerHTML =
      '<button class="btn btn-sm" onclick="nfcWriteElegoo(' + filamentId + ')">↻ Réessayer</button>';
  }
}

async function nfcReadCurrentCard() {
  try {
    const r = await API.get('/nfc/read');
    const result = document.getElementById('nfc-scan-result');
    if (!result) return;
    result.style.display = 'block';
    if (r.data) {
      result.innerHTML = `
        <div style="background:var(--bg3);border-radius:var(--radius);padding:10px;font-size:12px">
          <div style="font-weight:500;margin-bottom:6px">Données sur la puce :</div>
          <div>Nom : ${r.data.name||'—'}</div>
          <div>Matière : ${r.data.material||'—'} · ${r.data.color||''}</div>
          <div>Marque : ${r.data.brand||'—'}</div>
          <div>Stock : ${r.data.weight||0}g</div>
        </div>`;
    } else {
      result.innerHTML = `<div style="font-size:12px;color:var(--text3);text-align:center">
        Aucune donnée FilaFlow sur cette puce (UID : ${r.uid})</div>`;
    }
  } catch (e) { toast('Erreur lecture : ' + e.message, 'error'); }
}

async function openNfcLinkPicker() {
  const filaments = await API.get('/filaments');
  const uid = _nfcStatus.lastCard?.uid;
  if (!uid) { toast('Aucune puce détectée', 'error'); return; }

  openModal(`
    <div style="margin-bottom:14px;font-size:13px;color:var(--text2)">
      Lier la puce <code style="background:var(--bg3);padding:2px 6px;border-radius:4px">${uid}</code>
      à un filament :
    </div>
    <div class="form-group">
      <select id="nfc-link-filament">
        <option value="">— Sélectionner —</option>
        ${filaments.map(f => `<option value="${f.id}">${f.name} · ${f.material} · ${Math.round(f.weight_remaining)}g</option>`).join('')}
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="openNfcScanModal()">Retour</button>
      <button class="btn btn-primary" onclick="nfcLinkFromPicker()">Lier</button>
    </div>
  `, 'Lier la puce à un filament');
}

async function nfcLinkFromPicker() {
  const id = document.getElementById('nfc-link-filament').value;
  if (!id) return toast('Sélectionnez un filament', 'error');
  await nfcLinkToFilament(parseInt(id));
}

// ── Init au chargement ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  nfcConnect();
  nfcInjectIndicator();
});

// Fermer la connexion SSE avant le rechargement de page
// évite le blocage sur "Chargement..." lors d'un F5
window.addEventListener('beforeunload', () => {
  if (_nfcEventSource) {
    _nfcEventSource.close();
    _nfcEventSource = null;
  }
});
