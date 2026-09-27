const TAB_RENDERERS = {
  filaments:    renderFilaments,
  spoolweights: renderSpoolweights,
  settings:     renderSettings,
  history:      renderHistory,
};

let currentTab = 'filaments';

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  const renderer = TAB_RENDERERS[tab];
  if (renderer) renderer();
}

document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    switchTab(el.dataset.tab);
  });
});

// Init
// ── Thèmes de couleur ────────────────────────────────────
const THEMES = {
  blue:   { accent:'#185FA5', accentBg:'#E6F1FB', accentDark:'#0C447C', accentDarkBg:'#042C53' },
  green:  { accent:'#1D7A47', accentBg:'#E3F5EC', accentDark:'#0E4F2D', accentDarkBg:'#0A2E1A' },
  purple: { accent:'#6B3FAC', accentBg:'#F0E9FB', accentDark:'#4A2880', accentDarkBg:'#2A1550' },
  red:    { accent:'#B03030', accentBg:'#FBECEC', accentDark:'#7A1E1E', accentDarkBg:'#4A1010' },
  orange: { accent:'#C05C10', accentBg:'#FAEEE4', accentDark:'#7A3A08', accentDarkBg:'#4A2004' },
  teal:   { accent:'#0D7D7D', accentBg:'#E2F5F5', accentDark:'#085555', accentDarkBg:'#042F2F' },
  slate:  { accent:'#4A5568', accentBg:'#EDF2F7', accentDark:'#2D3748', accentDarkBg:'#1A202C' },
  pink:   { accent:'#B03070', accentBg:'#FBECF4', accentDark:'#7A1E4E', accentDarkBg:'#4A0E2E' },
};

function applyTheme(name) {
  const t = THEMES[name] || THEMES.blue;
  let el = document.getElementById('theme-vars');
  if (!el) { el = document.createElement('style'); el.id = 'theme-vars'; document.head.appendChild(el); }
  el.textContent =
    ':root { --accent:' + t.accent + '; --accent-bg:' + t.accentBg + '; --info:' + t.accent + '; --info-bg:' + t.accentBg + ' }' +
    ':root[data-color-scheme="dark"] { --accent:' + t.accent + '; --accent-bg:' + t.accentDark + '; --info:' + t.accent + '; --info-bg:' + t.accentDarkBg + ' }' +
    '@media (prefers-color-scheme:dark) { :root:not([data-color-scheme="light"]) { --accent:' + t.accent + '; --accent-bg:' + t.accentDark + '; --info:' + t.accent + '; --info-bg:' + t.accentDarkBg + ' } }';
}

// ── Gestion du mode sombre automatique ────────────────────────────────────
var _colorModeInterval = null;

function applyColorMode(mode, darkFrom, darkTo) {
  // mode: 'auto-system' | 'auto-time' | 'dark' | 'light' | null (manuel)
  if (_colorModeInterval) { clearInterval(_colorModeInterval); _colorModeInterval = null; }
  if (window._colorModeQuery) {
    try { window._colorModeQuery.removeEventListener('change', window._colorModeHandler); } catch(_) {}
  }

  if (mode === 'auto-system') {
    // Suivre le thème système
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = function(e) {
      document.documentElement.setAttribute('data-color-scheme', e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    window._colorModeQuery   = mq;
    window._colorModeHandler = handler;
    document.documentElement.setAttribute('data-color-scheme', mq.matches ? 'dark' : 'light');

  } else if (mode === 'auto-time') {
    // Sombre entre darkFrom et darkTo (heures entières)
    const checkTime = function() {
      const h = new Date().getHours();
      const from = parseInt(darkFrom) || 20;
      const to   = parseInt(darkTo)   || 7;
      let isDark;
      if (from > to) {
        isDark = h >= from || h < to;   // ex: 20h-7h (passe minuit)
      } else {
        isDark = h >= from && h < to;   // ex: 1h-6h
      }
      document.documentElement.setAttribute('data-color-scheme', isDark ? 'dark' : 'light');
    };
    checkTime();
    _colorModeInterval = setInterval(checkTime, 60000); // vérifier chaque minute

  } else if (mode === 'dark') {
    document.documentElement.setAttribute('data-color-scheme', 'dark');
  } else if (mode === 'light') {
    document.documentElement.setAttribute('data-color-scheme', 'light');
  } else {
    // Manuel — laisser le CSS @media gérer
    document.documentElement.removeAttribute('data-color-scheme');
  }
}

// Valeurs par défaut — évite tout affichage parasite avant le chargement des settings
window._showPrices             = false;
window._showLocations          = false;
window._stockAlertEnabled      = false;

// Charger les settings puis démarrer l'interface
(async () => {
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    if (s.theme) applyTheme(s.theme);
    // Appliquer le mode sombre
    applyColorMode(s.color_mode || null, s.dark_from || '20', s.dark_to || '7');
    // Appliquer le nom de l'application
    if (s.app_name) {
      const logoEl = document.querySelector('.logo-name');
      if (logoEl) logoEl.textContent = s.app_name;
      document.title = s.app_name;
    }
    window._showPrices             = s.show_prices         !== 'false';
    window._showLocations          = s.show_locations      !== 'false';
    window._stockAlertEnabled      = s.stock_alert_enabled !== 'false';
    window._stockAlertThreshold    = parseInt(s.stock_alert_threshold) || 20;
  } catch(_) {}

  // Auth optionnelle — ne bloque jamais le démarrage
  try { checkAuth(); } catch(_) {}

  // Démarrer sur les filaments, ou sur la fiche ciblée par le hash (#filament/5)
  const hash = window.location.hash;
  switchTab('filaments');
  if (hash && hash.startsWith('#filament/')) {
    const filamentId = parseInt(hash.replace('#filament/', ''));
    if (filamentId) {
      setTimeout(function() {
        if (typeof openFilamentForm === 'function') openFilamentForm(filamentId);
      }, 800);
    }
  }
})();

// ── Sidebar mobile/tablette ───────────────────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const isOpen   = sidebar.classList.contains('sidebar-open');
  if (isOpen) closeSidebar();
  else openSidebar();
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('sidebar-open');
  document.getElementById('sidebar-overlay').classList.add('visible');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('sidebar-open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

// Fermer la sidebar sur navigation (mobile)
const _origSwitchTab = switchTab;
window.switchTab = function(tab) {
  if (window.innerWidth <= 768) closeSidebar();
  _origSwitchTab(tab);
};

// Afficher/masquer le bouton hamburger selon la taille
function updateHamburger() {
  const btn = document.getElementById('hamburger-btn');
  if (btn) btn.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
}
window.addEventListener('resize', updateHamburger);
updateHamburger();

// ── Raccourcis clavier ─────────────────────────────────────────────────────
const KB_SHORTCUTS = [
  { key: 'f', tab: 'filaments',    label: 'Filaments' },
  { key: 'w', tab: 'spoolweights', label: 'Bobines réf.' },
  { key: 'h', tab: 'history',      label: 'Historique' },
  { key: ',', tab: 'settings',     label: 'Paramètres' },
];

document.addEventListener('keydown', function(e) {
  // Ignorer si focus dans un input/textarea/select ou modale ouverte
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (document.getElementById('modal-overlay')?.style.display === 'flex') return;

  // ? → afficher la cheatsheet des raccourcis
  if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
    toggleShortcutsHelp();
    return;
  }

  // Pas de modifier key
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

  const sc = KB_SHORTCUTS.find(function(s) { return s.key === e.key; });
  if (!sc) return;

  const tabId = sc.tabId || sc.tab;
  // Vérifier que l'onglet est visible (pas désactivé)
  const navEl = document.querySelector('[data-tab="' + tabId + '"]');
  if (!navEl || navEl.style.display === 'none') return;

  e.preventDefault();
  switchTab(tabId);

  // Flash de confirmation discret
  showShortcutToast(sc.key, sc.label);
});

function showShortcutToast(key, label) {
  const existing = document.getElementById('kb-flash');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'kb-flash';
  el.style.cssText = 'position:fixed;bottom:70px;right:24px;z-index:500;' +
    'background:var(--bg2);border:0.5px solid var(--border2);border-radius:var(--radius);' +
    'padding:8px 14px;font-size:12px;color:var(--text2);display:flex;align-items:center;gap:8px;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:slideIn 0.15s ease;pointer-events:none';
  el.innerHTML = '<kbd style="background:var(--bg3);border:0.5px solid var(--border2);' +
    'border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;font-family:monospace">' +
    key + '</kbd><span>→ ' + label + '</span>';
  document.body.appendChild(el);
  setTimeout(function() { if (el.parentNode) el.remove(); }, 1200);
}

// Cheatsheet des raccourcis (touche ?)
function toggleShortcutsHelp() {
  const existing = document.getElementById('shortcuts-panel');
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.id = 'shortcuts-panel';
  panel.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:500;' +
    'background:var(--bg2);border:0.5px solid var(--border2);border-radius:var(--radius-lg);' +
    'padding:16px 20px;box-shadow:0 8px 24px rgba(0,0,0,0.2);min-width:220px';

  const rows = KB_SHORTCUTS.map(function(s) {
    const navEl = document.querySelector('[data-tab="' + (s.tabId||s.tab) + '"]');
    if (navEl && navEl.style.display === 'none') return ''; // Onglet désactivé
    return '<div style="display:flex;align-items:center;justify-content:space-between;' +
      'padding:4px 0;font-size:12px">' +
      '<span style="color:var(--text2)">' + s.label + '</span>' +
      '<kbd style="background:var(--bg3);border:0.5px solid var(--border2);' +
      'border-radius:4px;padding:2px 8px;font-family:monospace;font-size:11px;' +
      'font-weight:600;margin-left:16px">' + s.key + '</kbd>' +
    '</div>';
  }).join('');

  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
      '<span style="font-size:13px;font-weight:600">Raccourcis clavier</span>' +
      '<button onclick="document.getElementById(\'shortcuts-panel\').remove()" ' +
        'style="border:none;background:none;cursor:pointer;color:var(--text3);font-size:16px">✕</button>' +
    '</div>' +
    '<div style="border-bottom:0.5px solid var(--border);margin-bottom:8px;padding-bottom:8px">' +
      rows +
    '</div>' +
    '<div style="margin-top:10px;font-size:11px;color:var(--text3);text-align:center">' +
      'Appuyez sur <kbd style="background:var(--bg3);border:0.5px solid var(--border2);' +
      'border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">?</kbd> pour fermer' +
    '</div>';

  document.body.appendChild(panel);

  // Fermeture automatique après 5s
  setTimeout(function() { if (panel.parentNode) panel.remove(); }, 5000);
}

// ── Toggle thème clair/sombre ─────────────────────────────────────────────
function toggleDarkMode() {
  const root    = document.documentElement;
  const current = root.getAttribute('data-color-scheme');
  const next    = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-color-scheme', next);

  // Mettre à jour l'icône
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';

  // Sauvegarder la préférence (override le mode auto)
  try { API.put('/settings', { color_mode: next }); } catch(_) {}
}

// Initialiser l'icône au chargement selon le thème actif
(function initThemeBtn() {
  function update() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    const isDark = document.documentElement.getAttribute('data-color-scheme') === 'dark' ||
      (!document.documentElement.getAttribute('data-color-scheme') &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.title = isDark ? 'Passer en mode clair' : 'Passer en mode sombre';
  }
  // Observer les changements de thème
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-scheme'] });
  // Init après chargement
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', update);
  } else {
    setTimeout(update, 100);
  }
})();

// ── Sections repliables ───────────────────────────────────────────────────
function toggleCollapse(sectionId) {
  const section = document.getElementById(sectionId);
  const icon    = document.getElementById(sectionId + '-icon');
  if (!section) return;
  const isCollapsed = section.style.display === 'none';
  section.style.display = isCollapsed ? '' : 'none';
  if (icon) icon.textContent = isCollapsed ? '▼' : '▶';
}
