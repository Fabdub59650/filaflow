/* ══════════════════════════════════════════════════════════════
   Barre d'applis commune : FilaFlow · PrepFlow · ModelFlow
   ──────────────────────────────────────────────────────────────
   Ce fichier est IDENTIQUE dans les trois dépôts (frontend/js/apps-nav.js).
   Le modifier dans un dépôt = le recopier à l'identique dans les deux autres.

   Usage : <span id="apps-nav"></span> dans l'en-tête, puis
           <script src="js/apps-nav.js" defer></script>
   L'app courante est reconnue par l'adresse (/prepflow/, /modelflow/, sinon FilaFlow)
   et mise en évidence avec l'accent (--accent) de l'app. Les styles sont dans ce fichier.
   ══════════════════════════════════════════════════════════════ */
(function () {
  var APPS = [
    { key: 'filaflow',  label: 'FilaFlow',  href: '/' },
    { key: 'prepflow',  label: 'PrepFlow',  href: '/prepflow/' },
    { key: 'modelflow', label: 'ModelFlow', href: '/modelflow/' },
  ];

  var CSS =
    '.apps-nav{display:inline-flex;align-items:center;gap:2px;padding:2px;border:0.5px solid var(--border2,#3A3C41);border-radius:var(--radius,4px);background:var(--bg,#141517)}' +
    '.apps-nav a{display:inline-flex;align-items:center;height:26px;padding:0 9px;border-radius:3px;font-family:var(--font-display,sans-serif);font-weight:600;font-size:14px;letter-spacing:var(--tracking-action,.08em);text-transform:uppercase;text-decoration:none;color:var(--text2,#A9A69F);white-space:nowrap}' +
    '.apps-nav a:hover{color:var(--text,#E8E6E1);background:var(--bg3,#232528)}' +
    '.apps-nav a.is-current{color:var(--accent,#5CB8E6);background:var(--accent-bg,#15303D);cursor:default}' +
    '@media (max-width:700px){.apps-nav a{padding:0 6px;font-size:12px}}';

  function current() {
    var p = location.pathname;
    if (p.indexOf('/prepflow/') === 0 || p === '/prepflow') return 'prepflow';
    if (p.indexOf('/modelflow/') === 0 || p === '/modelflow') return 'modelflow';
    return 'filaflow';
  }

  function mount() {
    var box = document.getElementById('apps-nav');
    if (!box) return;
    if (!document.getElementById('apps-nav-style')) {
      var st = document.createElement('style');
      st.id = 'apps-nav-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    var here = current();
    box.className = 'apps-nav';
    box.setAttribute('role', 'navigation');
    box.setAttribute('aria-label', 'Applications');
    box.innerHTML = '';
    APPS.forEach(function (app) {
      var a = document.createElement('a');
      a.textContent = app.label;
      a.href = app.href;
      if (app.key === here) { a.className = 'is-current'; a.setAttribute('aria-current', 'page'); }
      box.appendChild(a);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
