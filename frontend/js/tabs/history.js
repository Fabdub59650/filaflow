async function renderHistory() {
  const existingEntity = document.getElementById('hist-entity');
  const entity = existingEntity ? existingEntity.value : '';

  document.getElementById('page-title').textContent = 'Historique';
  document.getElementById('topbar-actions').innerHTML =
    '<select id="hist-entity" onchange="renderHistory()" style="font-size:12px;margin-right:8px">' +
      '<option value="">🗂 Toutes les entités</option>' +
      '<option value="filament">🧵 Filaments</option>' +
      '<option value="nfc">📡 NFC</option>' +
      '<option value="settings">⚙️ Paramètres</option>' +
    '</select>' +
    '<button class="btn btn-sm" onclick="renderHistory()">↺ Actualiser</button>';

  // Forcer la valeur du select après reconstruction du DOM
  const selectEl = document.getElementById('hist-entity');
  if (selectEl && entity) selectEl.value = entity;

  const content = document.getElementById('content');
  content.innerHTML = '<div style="color:var(--text3);padding:20px 0">Chargement…</div>';

  const selectedEntity = selectEl ? selectEl.value : '';
  let url = '/history?limit=100';
  if (selectedEntity) url += '&entity=' + selectedEntity;

  let rows;
  try {
    rows = await API.get(url);
    if (!Array.isArray(rows)) rows = [];
  } catch(e) {
    content.innerHTML = '<div style="color:var(--danger);padding:20px 0">' + e.message + '</div>';
    return;
  }

  if (!rows.length) {
    const emptyMsg = selectedEntity === 'nfc'
      ? 'Aucune écriture NFC enregistrée. Les écritures apparaîtront ici après avoir utilisé la fonction NFC.'
      : 'Aucune modification enregistrée.';
    content.innerHTML = '<div class="empty-state"><p>' + emptyMsg + '</p></div>';
    return;
  }

  // Couleurs fixes (pas de var() dans les valeurs inline pour compatibilité Safari)
  const ACTION_STYLES = {
    create:    { bg: '#10b98122', color: '#10b981' },
    update:    { bg: '#3b82f622', color: '#3b82f6' },
    delete:    { bg: '#ef444422', color: '#ef4444' },
    archive:   { bg: '#88888822', color: '#888888' },
    nfc_write: { bg: '#f59e0b22', color: '#f59e0b' },
    accepted:  { bg: '#10b98122', color: '#10b981' },
    refused:   { bg: '#ef444422', color: '#ef4444' },
  };

  const ACTION_LABELS = {
    create:    'Créé',
    update:    'Modifié',
    delete:    'Supprimé',
    archive:   'Archivé',
    nfc_write: 'NFC écrit',
    accepted:  'Accepté',
    refused:   'Refusé',
  };

  const ENTITY_LABELS = {
    filament: '🎨 Filament',
    nfc:      '📡 NFC',
    settings: '⚙️ Paramètres',
  };

  content.innerHTML =
    '<div class="card">' +
      '<table>' +
        '<thead><tr>' +
          '<th style="width:140px">Date</th>' +
          '<th style="width:120px">Entité</th>' +
          '<th style="width:90px">Action</th>' +
          '<th>Détail</th>' +
        '</tr></thead>' +
        '<tbody>' +
          rows.map(function(r) {
            const style = ACTION_STYLES[r.action] || { bg: '#88888822', color: '#888888' };
            const label = ACTION_LABELS[r.action] || r.action;
            const ent   = ENTITY_LABELS[r.entity] || r.entity;
            return '<tr>' +
              '<td style="font-size:11px;color:#888;white-space:nowrap">' + fmtDateTime(r.created_at) + '</td>' +
              '<td style="font-size:12px">' + ent + '</td>' +
              '<td><span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + style.bg + ';color:' + style.color + '">' + label + '</span></td>' +
              '<td style="font-size:12px">' +
                (r.entity === 'nfc' && r.color_hex
                  ? '<span style="display:inline-flex;align-items:center;gap:5px">' +
                    '<span class="filament-dot" style="background:' + r.color_hex + ';width:10px;height:10px;border-radius:50%;display:inline-block;flex-shrink:0"></span>' +
                    (r.detail||'—') + '</span>'
                  : (r.detail||'—')) +
              '</td>' +
            '</tr>';
          }).join('') +
        '</tbody>' +
      '</table>' +
    '</div>';
}
