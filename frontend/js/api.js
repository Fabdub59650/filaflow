// ── Authentification ──────────────────────────────────────
let _authToken = '';
// Lire le token depuis localStorage ou depuis le cookie (survit au cache)
try {
  _authToken = localStorage.getItem('pf_auth_token') || '';
  if (!_authToken) {
    // Fallback : lire depuis le cookie pf_auth
    const match = document.cookie.match(/(?:^|;)\s*pf_auth=([^;]+)/);
    if (match) _authToken = decodeURIComponent(match[1]);
  }
} catch(_) {}

async function checkAuth() {
  try {
    const r = await fetch('/api/auth/status');
    if (!r.ok) return;
    const d = await r.json();
    if (d.required && !_authToken) showLoginModal();
  } catch(_) {} // Ne jamais bloquer le démarrage
}

function showLoginModal() {
  if (document.getElementById('login-modal')) return;
  const div = document.createElement('div');
  div.id = 'login-modal';
  div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999';
  div.innerHTML =
    '<div style="background:var(--bg2);border-radius:var(--radius-lg);padding:32px;min-width:320px;box-shadow:0 20px 60px rgba(0,0,0,0.5)">' +
      '<div style="font-size:16px;font-weight:600;margin-bottom:4px">FilaFlow</div>' +
      '<div style="font-size:13px;color:var(--text3);margin-bottom:20px">Connexion requise</div>' +
      '<input id="login-pwd" type="password" placeholder="Mot de passe" style="width:100%;margin-bottom:12px" ' +
        'onkeydown="if(event.key===\'Enter\')doLogin()">' +
      '<button class="btn btn-primary" style="width:100%" onclick="doLogin()">Connexion</button>' +
      '<div id="login-error" style="color:var(--danger);font-size:12px;margin-top:8px;display:none">Mot de passe incorrect</div>' +
    '</div>';
  document.body.appendChild(div);
  setTimeout(() => { try { document.getElementById('login-pwd').focus(); } catch(_) {} }, 100);
}

async function doLogin() {
  const pwdEl = document.getElementById('login-pwd');
  const pwd   = pwdEl ? pwdEl.value : '';
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const d = await r.json();
    if (d.ok) {
      _authToken = d.token || pwd;
      try {
  localStorage.setItem('pf_auth_token', _authToken);
  // Cookie persistant 1 an (survit au vidage du cache navigateur)
  const expires = new Date(Date.now() + 365*24*60*60*1000).toUTCString();
  document.cookie = 'pf_auth=' + encodeURIComponent(_authToken) + '; expires=' + expires + '; path=/; SameSite=Lax';
} catch(_) {}
      // Recharger pour que tous les écrans se chargent avec le jeton
      window.location.reload();
    } else {
      const err = document.getElementById('login-error');
      if (err) err.style.display = 'block';
    }
  } catch(_) {}
}

// En-têtes d'authentification pour les appels fetch() directs (upload, téléchargement)
function authHeaders(extra) {
  const h = Object.assign({}, extra || {});
  if (_authToken) h['X-Auth-Token'] = _authToken;
  return h;
}

// ── Wrapper fetch central ─────────────────────────────────
async function _apiFetch(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (_authToken) headers['X-Auth-Token'] = _authToken;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch('/api' + path, opts);
  if (r.status === 401) {
    _authToken = '';
    try {
  localStorage.removeItem('pf_auth_token');
  document.cookie = 'pf_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
} catch(_) {}
    showLoginModal();
    throw new Error('Non authentifié');
  }
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch(_) {}
    throw new Error(msg);
  }
  return r.json();
}

const API = {
  get:   (path)       => _apiFetch('GET',    path),
  post:  (path, body) => _apiFetch('POST',   path, body),
  put:   (path, body) => _apiFetch('PUT',    path, body),
  patch: (path, body) => _apiFetch('PATCH',  path, body),
  del:   (path, body)  => _apiFetch('DELETE', path, body),
};

// ── Toast ────────────────────────────────────────────────
function toast(msg, type = 'default') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  const container = document.getElementById('toast-container');
  if (container) container.appendChild(t);
  setTimeout(() => { try { t.remove(); } catch(_) {} }, 3500);
}
