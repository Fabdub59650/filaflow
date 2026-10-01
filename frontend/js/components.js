function openModal(html, title, options) {
  const modal = document.getElementById('modal');
  const tabbed = options && options.tabbed;
  const wide   = options && options.wide;
  const xl     = options && options.xl;
  modal.className = 'modal' + (tabbed ? ' modal-tabbed' : '') + (xl ? ' modal-xl' : wide ? ' modal-wide' : '');

  if (tabbed) {
    // Séparer le footer du reste pour le garder fixe en bas
    const footerMatch = html.match(/(<div class="modal-footer">[\s\S]*<\/div>)\s*$/);
    const footer = footerMatch ? footerMatch[1] : '';
    const body   = footerMatch ? html.slice(0, html.lastIndexOf(footerMatch[1])) : html;
    modal.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">${title}</span>
        <button class="btn btn-sm" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-tab-body">${body}</div>
      ${footer}`;
  } else {
    modal.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">${title}</span>
        <button class="btn btn-sm" onclick="closeModal()">✕</button>
      </div>
      ${html}`;
  }

  modal.classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.add('hidden');
  modal.className = 'modal hidden';
  document.getElementById('modal-overlay').classList.add('hidden');
}

function openModal2(html, title) {
  const modal = document.getElementById('modal2');
  modal.innerHTML =
    '<div class="modal-header">' +
      '<span class="modal-title">' + title + '</span>' +
      '<button class="btn btn-sm" onclick="closeModal2()">✕</button>' +
    '</div>' + html;
  modal.classList.remove('hidden');
  document.getElementById('modal2-overlay').classList.remove('hidden');
}

function closeModal2() {
  const modal = document.getElementById('modal2');
  modal.classList.add('hidden');
  document.getElementById('modal2-overlay').classList.add('hidden');
}

function pct(remaining, total) {
  if (!total) return 0;
  return Math.round((remaining / total) * 100);
}

function fmtDuration(minutes) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m > 0 ? m + 'min' : ''}` : `${m}min`;
}

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

// Date et heure au format « 01.10.2026 19:21 » (année toujours affichée)
function fmtDateTime(str) {
  if (!str) return '—';
  const d = new Date(String(str).replace(' ', 'T'));
  if (isNaN(d)) return String(str);
  const p = n => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function confirmDelete(msg, cb) {
  if (confirm(msg)) cb();
}

