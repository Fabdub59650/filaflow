async function renderSettings() {
  document.getElementById('page-title').textContent = 'Paramètres';
  document.getElementById('topbar-actions').innerHTML = '';
  document.getElementById('content').innerHTML = '<div style="color:var(--text3);padding:20px 0">Chargement…</div>';

  const settings = await API.get('/settings');
  const currentTheme    = settings.theme || 'signal';

  if (!window._settingsTab) window._settingsTab = 'interface';
  const tab = window._settingsTab;

  const tabDefs = [
    { id:'interface',    label:'🎨️ Interface'    },
    { id:'donnees',      label:'💾 Données'      },
    { id:'integrations', label:'⚖️ Balance'  },
    { id:'systeme',      label:'⚙️ Système'    },
  ];

  const tabBar = '<div style="display:flex;gap:0;border-bottom:2px solid var(--border2);margin-bottom:20px;flex-wrap:wrap">' +
    tabDefs.map(function(t) {
      const active = tab === t.id;
      return '<button onclick="switchSettingsTab(\'' + t.id + '\',this)" ' +
        'style="padding:8px 16px;font-size:13px;font-weight:' + (active?'600':'400') + ';' +
        'border:none;cursor:pointer;background:transparent;' +
        'color:' + (active?'var(--accent)':'var(--text2)') + ';' +
        'border-bottom:' + (active?'2px solid var(--accent)':'2px solid transparent') + ';' +
        'margin-bottom:-2px;transition:all 0.15s;white-space:nowrap">' + t.label + '</button>';
    }).join('') +
  '</div>' +
  '<div id="settings-tab-content"></div>';

  document.getElementById('content').innerHTML = tabBar;

  // Générer le contenu de l'onglet actif
  const el = document.getElementById('settings-tab-content');
  if (!el) return;

  switch(tab) {
    case 'interface':
      el.innerHTML = `
    <!-- ── Apparence ──────────────────────────────── -->
    <div class="card">
      <div class="card-header"><span class="card-title">Apparence</span></div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Nom de l'application</label>
          <input id="set-app-name" value="${settings.app_name||'FilaFlow'}">
        </div>
        <div class="form-group">
          <label class="form-label">Thème de couleurs</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px" id="theme-picker">
            ${Object.entries({
              signal:'Signal', blue:'Bleu', green:'Vert', purple:'Violet', red:'Rouge',
              orange:'Orange', teal:'Turquoise', slate:'Ardoise', pink:'Rose'
            }).map(([key, label]) => `
            <div onclick="selectTheme('${key}')" id="theme-btn-${key}"
                 style="display:flex;align-items:center;gap:6px;padding:6px 12px;
                        border-radius:var(--radius);cursor:pointer;font-size:12px;font-weight:500;
                        border:2px solid ${key===currentTheme?'var(--accent)':'transparent'};
                        background:${key===currentTheme?'var(--accent-bg)':'var(--bg3)'}">
              <span style="width:12px;height:12px;border-radius:50%;background:${themeAccent(key)};flex-shrink:0"></span>
              ${label}
            </div>`).join('')}
          </div>
          <input type="hidden" id="set-theme" value="${currentTheme}">
        </div>
        <div class="form-group">
          <label class="form-label">Mode sombre</label>
          <select id="set-color-mode" onchange="previewColorMode(this.value)">
            <option value=""      ${!settings.color_mode||settings.color_mode===''?'selected':''}>Atelier sombre (par défaut)</option>
            <option value="light" ${settings.color_mode==='light'?'selected':''}>Toujours clair</option>
            <option value="dark"  ${settings.color_mode==='dark'?'selected':''}>Toujours sombre</option>
            <option value="auto-system" ${settings.color_mode==='auto-system'?'selected':''}>Suivre le thème système</option>
            <option value="auto-time"   ${settings.color_mode==='auto-time'?'selected':''}>Selon l'heure</option>
          </select>
          <div id="color-mode-time-wrap" style="display:${settings.color_mode==='auto-time'?'flex':'none'};gap:12px;margin-top:8px;align-items:center;flex-wrap:wrap">
            <span style="font-size:13px;color:var(--text2)">Sombre de</span>
            <select id="set-dark-from" style="width:80px">
              ${Array.from({length:24},(_,i)=>'<option value="'+i+'"'+(String(settings.dark_from||'20')==String(i)?' selected':'')+'>'+String(i).padStart(2,'0')+'h</option>').join('')}
            </select>
            <span style="font-size:13px;color:var(--text2)">à</span>
            <select id="set-dark-to" style="width:80px">
              ${Array.from({length:24},(_,i)=>'<option value="'+i+'"'+(String(settings.dark_to||'7')==String(i)?' selected':'')+'>'+String(i).padStart(2,'0')+'h</option>').join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Toggles champs optionnels -->
      <div style="margin-top:16px;display:flex;flex-direction:column;gap:12px">
        <div style="font-size:12px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em">
          Champs optionnels
        </div>
        <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer">
          <div>
            <div style="font-size:13px">Gestion des prix</div>
            <div style="font-size:11px;color:var(--text3)">Affiche le champ Prix dans les fiches filament</div>
          </div>
          <div onclick="toggleSetting('show_prices', this)" id="toggle-show-prices"
               data-enabled="${settings.show_prices!=='false'?'1':'0'}"
               style="width:40px;height:22px;border-radius:11px;cursor:pointer;transition:background 0.2s;
                      background:${settings.show_prices!=='false'?'var(--accent)':'var(--border2)'};position:relative;flex-shrink:0">
            <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;
                        top:2px;transition:left 0.2s;left:${settings.show_prices!=='false'?'19px':'2px'}"></div>
          </div>
        </label>
        <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer">
          <div>
            <div style="font-size:13px">Gestion des emplacements</div>
            <div style="font-size:11px;color:var(--text3)">Affiche le champ Emplacement dans les fiches filament</div>
          </div>
          <div onclick="toggleSetting('show_locations', this)" id="toggle-show-locations"
               data-enabled="${settings.show_locations!=='false'?'1':'0'}"
               style="width:40px;height:22px;border-radius:11px;cursor:pointer;transition:background 0.2s;
                      background:${settings.show_locations!=='false'?'var(--accent)':'var(--border2)'};position:relative;flex-shrink:0">
            <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;
                        top:2px;transition:left 0.2s;left:${settings.show_locations!=='false'?'19px':'2px'}"></div>
          </div>
        </label>
        <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer">
          <div>
            <div style="font-size:13px">Alertes stock filament</div>
            <div style="font-size:11px;color:var(--text3)">Affiche un bandeau en haut de la liste des filaments quand des bobines sont presque vides</div>
          </div>
          <div onclick="toggleSetting('stock_alert_enabled', this)" id="toggle-stock-alert"
               data-enabled="${settings.stock_alert_enabled!=='false'?'1':'0'}"
               style="width:40px;height:22px;border-radius:11px;cursor:pointer;transition:background 0.2s;
                      background:${settings.stock_alert_enabled!=='false'?'var(--accent)':'var(--border2)'};position:relative;flex-shrink:0">
            <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;
                        top:2px;transition:left 0.2s;left:${settings.stock_alert_enabled!=='false'?'19px':'2px'}"></div>
          </div>
        </label>
        <div id="stock-alert-threshold-wrap" style="display:${settings.stock_alert_enabled!=='false'?'flex':'none'};align-items:center;gap:10px;padding-left:4px">
          <label style="font-size:13px;color:var(--text2)">Seuil d'alerte</label>
          <input id="set-stock-threshold" type="number" min="5" max="50" step="5"
                 value="${settings.stock_alert_threshold||20}"
                 style="width:70px" onchange="saveSettings()">
          <span style="font-size:13px;color:var(--text3)">% restant</span>
        </div>
      </div>

      <div style="margin-top:14px">
        <button class="btn btn-primary" onclick="saveSettings()">Enregistrer</button>
      </div>
    </div>

    <!-- ── Authentification ───────────────────────────────── -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Accès et sécurité</span>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
          <span style="color:var(--text2)">Activer</span>
          <div onclick="toggleSetting('auth_enabled', this)" id="toggle-auth"
               data-enabled="${settings.auth_enabled==='true'?'1':'0'}"
               style="width:40px;height:22px;border-radius:11px;cursor:pointer;transition:background 0.2s;
                      background:${settings.auth_enabled==='true'?'var(--accent)':'var(--border2)'};position:relative">
            <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;
                        top:2px;transition:left 0.2s;left:${settings.auth_enabled==='true'?'19px':'2px'}"></div>
          </div>
        </label>
      </div>
      <div id="auth-config" style="display:${settings.auth_enabled==='true'?'block':'none'}">
        <div class="form-grid">
          <div class="form-group full">
            <label class="form-label">Mot de passe d'accès</label>
            <div style="position:relative">
              <input id="set-auth-password" type="password" value="${settings.auth_password||''}"
                     placeholder="Définir un mot de passe" style="padding-right:36px;width:100%">
              <button type="button" onclick="togglePwdVisibility('set-auth-password','eye-auth-1')"
                      style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:2px;color:var(--text3)">
                <svg id="eye-auth-1" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="form-group full">
            <label class="form-label">Confirmer le mot de passe</label>
            <div style="position:relative">
              <input id="set-auth-password-confirm" type="password"
                     placeholder="Retaper le mot de passe" style="padding-right:36px;width:100%">
              <button type="button" onclick="togglePwdVisibility('set-auth-password-confirm','eye-auth-2')"
                      style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:2px;color:var(--text3)">
                <svg id="eye-auth-2" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
            <div id="pwd-match-msg" style="font-size:11px;margin-top:4px;display:none"></div>
            <div style="font-size:11px;color:var(--text3);margin-top:4px">
              Une fois activé, ce mot de passe sera demandé à chaque connexion depuis le réseau.
            </div>
          </div>
        </div>
        <div style="margin-top:12px">
          <button class="btn btn-primary" onclick="saveAuthSettings()">Enregistrer le mot de passe</button>
        </div>
      </div>
    </div>

    <!-- ── PWA et Notifications ─────────────────── -->
    <div class="card">
      <div class="card-header"><span class="card-title">Application mobile (PWA)</span></div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:14px">
        FilaFlow peut être installé comme application sur votre mobile ou tablette pour un accès rapide sans navigateur.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" onclick="installPWA()" id="pwa-install-btn-settings">
          ↓ Installer l'application
        </button>
        <span style="font-size:12px;color:var(--text3)">
          Sur iOS : Safari → Partager → Sur l'écran d'accueil
        </span>
      </div>

    </div>`;
      // Synchroniser le thème actif
      document.querySelectorAll('.theme-btn').forEach(function(b) {
        b.style.outline = b.dataset.theme === currentTheme ? '3px solid var(--accent)' : 'none';
      });
      break;

    case 'donnees':
      el.innerHTML = `

    <!-- ── Sauvegarde ──────────────────────────────── -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Sauvegarde automatique</span>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
          <span style="color:var(--text2)">Activer</span>
          <div onclick="toggleBackup()" id="backup-toggle"
               style="width:40px;height:22px;border-radius:11px;cursor:pointer;transition:background 0.2s;
                      background:${settings.backup_enabled==='true'?'var(--accent)':'var(--border2)'};position:relative">
            <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;
                        top:2px;transition:left 0.2s;left:${settings.backup_enabled==='true'?'19px':'2px'}"></div>
          </div>
        </label>
      </div>

      <div id="backup-config" style="display:${settings.backup_enabled==='true'?'block':'none'}">

        <!-- Destination — hors form-grid -->
        <div style="margin-bottom:14px">
          <div class="form-label" style="margin-bottom:8px">Destination</div>
          <div>
            <label style="cursor:pointer;font-size:13px;margin-right:32px;display:inline-flex;align-items:center;gap:4px;vertical-align:middle">
              <input type="radio" name="backup-dest" value="local" id="backup-dest-local"
                ${(settings.backup_destination||'local')==='local'?'checked':''}
                onchange="toggleBackupDest(this.value)" style="margin:0;width:14px;height:14px;flex-shrink:0">
              <span>Dossier local (Pi)</span>
            </label><label style="cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:4px;vertical-align:middle">
              <input type="radio" name="backup-dest" value="nas" id="backup-dest-nas"
                ${settings.backup_destination==='nas'?'checked':''}
                onchange="toggleBackupDest(this.value)" style="margin:0;width:14px;height:14px;flex-shrink:0">
              <span>NAS / Partage réseau (SMB)</span>
            </label>
          </div>
        </div>

        <div class="form-grid">

          <!-- Config local -->
          <div class="form-group full" id="backup-local-config"
               style="display:${(settings.backup_destination||'local')==='local'?'block':'none'}">
            <label class="form-label">Dossier de sauvegarde</label>
            <input id="set-backup-path" value="${settings.backup_path||'/opt/filaflow/backups'}"
                   placeholder="/opt/filaflow/backups">
          </div>

          <!-- Config NAS -->
          <div class="form-group full" id="backup-nas-config"
               style="display:${settings.backup_destination==='nas'?'block':'none'}">
            <div class="form-grid" style="margin-top:0">
              <div class="form-group">
                <label class="form-label">Adresse IP du NAS</label>
                <input id="set-nas-ip" value="${settings.backup_nas_ip||''}" placeholder="192.168.1.100">
              </div>
              <div class="form-group">
                <label class="form-label">Nom du partage</label>
                <input id="set-nas-share" value="${settings.backup_nas_share||''}" placeholder="backup">
              </div>
              <div class="form-group">
                <label class="form-label">Utilisateur</label>
                <input id="set-nas-user" value="${settings.backup_nas_user||''}" placeholder="pi">
              </div>
              <div class="form-group">
                <label class="form-label">Mot de passe</label>
                <input type="password" id="set-nas-password" value="" placeholder="${settings.backup_nas_password ? 'Configuré — laisser vide pour conserver' : 'Mot de passe'}">
              </div>
              <div class="form-group full">
                <label class="form-label">Dossier cible sur le NAS</label>
                <input id="set-nas-folder" value="${settings.backup_nas_folder||'/filaflow'}" placeholder="/filaflow">
              </div>
            </div>
            <button class="btn btn-sm" onclick="testNasConnection()" style="margin-top:8px">
              Tester la connexion
            </button>
            <span id="nas-test-result" style="font-size:12px;margin-left:10px"></span>
          </div>

          <!-- Planification -->
          <div class="form-group">
            <label class="form-label">Horaire (expression cron)</label>
            <input id="set-backup-schedule" value="${settings.backup_schedule||'0 3 * * *'}"
                   placeholder="0 3 * * *">
            <div style="font-size:11px;color:var(--text3);margin-top:3px">
              Format : minute heure * * * — ex: <code>0 3 * * *</code> = 3h chaque nuit,
              <code>0 3 * * 0</code> = 3h le dimanche
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Sauvegardes à conserver</label>
            <input id="set-backup-keep" type="number" min="1" max="30"
                   value="${settings.backup_keep||7}">
            <div style="font-size:11px;color:var(--text3);margin-top:3px">
              Stratégie incrémentielle — les fichiers inchangés partagent l'espace disque
            </div>
          </div>

        </div>

        <!-- Dernière sauvegarde -->
        <div id="backup-last-info" style="margin:12px 0;font-size:12px;color:var(--text3)"></div>

        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="saveBackupSettings()">Enregistrer</button>
          <button class="btn" onclick="runBackupNow()">↓ Sauvegarder maintenant</button>
        </div>
      </div>

      <div id="backup-status-display" style="margin-top:12px"></div>

      <div id="backup-list-wrap" style="margin-top:14px;display:${settings.backup_enabled==='true'?'block':'none'}">
        <div style="font-size:12px;font-weight:500;color:var(--text3);text-transform:uppercase;
                    letter-spacing:0.05em;margin-bottom:8px">Sauvegardes disponibles</div>
        <div id="backup-list"><span style="color:var(--text3);font-size:13px">Chargement…</span></div>
      </div>
    </div>

    <!-- ── Export complet ────────────────────────────── -->
    <div class="card">
      <div class="card-header"><span class="card-title">Export complet</span></div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
        Télécharge une archive <code>.tar.gz</code> contenant la base de données
        et la configuration.
        Utile pour migrer vers un nouveau Raspberry Pi ou faire une sauvegarde manuelle complète.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" onclick="exportFull()" id="btn-export-full">
          ↓ Télécharger l'export complet
        </button>
        <span id="export-status" style="font-size:12px;color:var(--text3)"></span>
      </div>
    </div>

    <!-- ── Restauration ──────────────────────────── -->
    <div class="card">
      <div class="card-header"><span class="card-title">Restauration</span></div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
        Restaurez la base de données depuis un fichier de sauvegarde <code>.sql</code>
        ou un export complet <code>.tar.gz</code>.
        <strong style="color:var(--danger)"> Attention : la restauration écrase les données actuelles.</strong>
      </p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="file" id="restore-file-input" accept=".sql,.tar.gz"
               onchange="previewRestoreFile(this)"
               style="font-size:12px;flex:1;min-width:200px">
        <button class="btn btn-primary" id="btn-restore" onclick="doRestore()" disabled>
          ↺ Restaurer
        </button>
      </div>
      <div id="restore-preview" style="margin-top:10px;font-size:12px;color:var(--text3)"></div>
      <div id="restore-status" style="margin-top:8px;font-size:13px"></div>
    </div>

`;

      loadBackupStatus();
      break;

    case 'integrations':
      el.innerHTML = `
    <!-- ── TigerTag Scale ───────────────────────── -->
    <div class="card">
      <div class="card-header"><span class="card-title">TigerTag Scale</span></div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
        Balance connectée ESP32 avec lecteur RFID. Quand une bobine est posée et stabilisée,
        la pesée est créée automatiquement dans FilaFlow.
      </p>
      <div style="background:var(--bg3);border-radius:var(--radius);padding:12px 14px;margin-bottom:14px;font-size:12px">
        <div style="font-weight:500;margin-bottom:6px">URL du webhook à configurer sur l'ESP32 :</div>
        <code id="tigertag-webhook-url" style="color:var(--accent);font-size:12px"></code>
        <div style="margin-top:6px;color:var(--text3)">Dans le firmware ESP32 — remplacer l'URL du cloud TigerTag par cette adresse
          (avec l'IP du Pi si la balance ne résout pas le nom).</div>
      </div>
      <div class="form-group" style="margin-bottom:14px">
        <label class="form-label">Jeton du webhook (optionnel)</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="set-tt-token" value="${settings.tigertag_webhook_token||''}" placeholder="Vide = aucun jeton exigé"
                 style="flex:1;min-width:220px;font-family:monospace;font-size:12px" oninput="updateTigerTagUrl()">
          <button class="btn btn-sm" onclick="generateTigerTagToken()">Générer</button>
          <button class="btn btn-sm btn-primary" onclick="saveTigerTagToken()">Enregistrer</button>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:6px">
          Si un jeton est défini, la balance doit l'envoyer (<code>?token=…</code> dans l'URL ou en-tête
          <code>X-Webhook-Token</code>). Mettez d'abord à jour le firmware, puis enregistrez le jeton ici.
        </div>
      </div>
      <div id="tigertag-recent" style="margin-top:8px"></div>
    </div>

`;
      updateTigerTagUrl();
      loadTigerTagRecent();
      break;

    case 'systeme':
      el.innerHTML = `
    <!-- ── Informations application ───────────────── -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><span class="card-title">FilaFlow</span></div>
      <div class="stat-row"><span class="stat-label">Application</span><span class="stat-val">${settings.app_name||'FilaFlow'}</span></div>
      <div class="stat-row"><span class="stat-label">Version</span><span class="stat-val">${settings._version || '—'}</span></div>
      <div class="stat-row"><span class="stat-label">Date de build</span><span class="stat-val">${settings._build_date || '—'}</span></div>
      <div class="stat-row"><span class="stat-label">Backend</span><span class="stat-val">Node.js + Express</span></div>
      <div class="stat-row"><span class="stat-label">Base de données</span><span class="stat-val">MariaDB</span></div>
    </div>
    <!-- ── Santé système ───────────────────────────── -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-header">
        <span class="card-title">Santé du système</span>
        <button class="btn btn-sm" onclick="loadSystemHealth()">↻ Actualiser</button>
      </div>
      <div id="system-health-content">
        <div style="color:var(--text3);font-size:13px;padding:8px 0">Chargement…</div>
      </div>
    </div>
    <!-- ── Mises à jour ────────────────────────────── -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Mises à jour</span>
        <button class="btn btn-sm" onclick="checkForUpdate()">Vérifier</button>
      </div>
      <div id="update-check-content">
        <div style="color:var(--text3);font-size:13px;padding:4px 0">Cliquez sur "Vérifier" pour rechercher une mise à jour.</div>
      </div>
    </div>

    <!-- ── Logs d'erreurs ────────────────────────────── -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Logs d'erreurs backend</span>
        <div style="display:flex;gap:6px">
          <select id="log-level-filter" onchange="loadBackendLogs()" style="font-size:12px">
            <option value="">Tous</option>
            <option value="error">Erreurs</option>
            <option value="warn">Avertissements</option>
          </select>
          <button class="btn btn-sm" onclick="loadBackendLogs()">↻</button>
          <button class="btn btn-sm btn-danger" onclick="clearBackendLogs()">Vider</button>
        </div>
      </div>
      <div id="backend-logs-content">
        <div style="color:var(--text3);font-size:13px">Chargement…</div>
      </div>
    </div>`;
      loadSystemHealth();
      loadBackendLogs();
      break;
  }
}

// ── Balance : jeton du webhook ───────────────────────────
function updateTigerTagUrl() {
  const el  = document.getElementById('tigertag-webhook-url');
  const tok = document.getElementById('set-tt-token')?.value.trim() || '';
  if (el) el.textContent = window.location.origin + '/api/tigertag/webhook' +
    (tok ? '?token=' + encodeURIComponent(tok) : '');
}

function generateTigerTagToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const input = document.getElementById('set-tt-token');
  if (input) input.value = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  updateTigerTagUrl();
}

async function saveTigerTagToken() {
  const tok = document.getElementById('set-tt-token')?.value.trim() || '';
  try {
    await API.put('/settings', { tigertag_webhook_token: tok });
    toast(tok ? 'Jeton enregistré — la balance doit maintenant l\'envoyer' : 'Jeton supprimé — webhook ouvert', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function switchSettingsTab(tab, btn) {
  window._settingsTab = tab;
  document.querySelectorAll('[onclick^="switchSettingsTab"]').forEach(function(b) {
    const active = b === btn;
    b.style.fontWeight   = active ? '600' : '400';
    b.style.color        = active ? 'var(--accent)' : 'var(--text2)';
    b.style.borderBottom = active ? '2px solid var(--accent)' : '2px solid transparent';
  });
  renderSettings();
}

// ── Toggle générique pour settings booléens ─────────────
function toggleSetting(key, el) {
  const enabled = el.dataset.enabled !== '1';
  el.dataset.enabled = enabled ? '1' : '0';
  const dot = el.querySelector('div');
  dot.style.left       = enabled ? '19px' : '2px';
  el.style.background  = enabled ? 'var(--accent)' : 'var(--border2)';
  // Sauvegarder immédiatement
  API.put('/settings', { [key]: String(enabled) }).catch(function(e) {
    console.error('[Settings] Erreur sauvegarde', key, ':', e.message);
    toast('Erreur sauvegarde paramètre', 'error');
  });
  // Mettre à jour la variable globale
  if (key === 'show_prices')        window._showPrices        = enabled;
  if (key === 'show_locations')     window._showLocations      = enabled;
  if (key === 'stock_alert_enabled') window._stockAlertEnabled = enabled;
  if (key === 'stock_alert_enabled') {
    const wrap = document.getElementById('stock-alert-threshold-wrap');
    if (wrap) wrap.style.display = enabled ? 'flex' : 'none';
  }
  if (key === 'auth_enabled') {
    const cfg = document.getElementById('auth-config');
    if (cfg) cfg.style.display = enabled ? 'block' : 'none';
  }

}

// ── Sélecteur de thème ────────────────────────────────────
function themeAccent(name) {
  const map = {
    signal:'#FF7A1A', blue:'#185FA5', green:'#1D7A47', purple:'#6B3FAC', red:'#B03030',
    orange:'#C05C10', teal:'#0D7D7D', slate:'#4A5568', pink:'#B03070'
  };
  return map[name] || '#185FA5';
}

function selectTheme(name) {
  document.getElementById('set-theme').value = name;
  // Mettre à jour visuellement les boutons
  Object.keys({ signal:1, blue:1, green:1, purple:1, red:1, orange:1, teal:1, slate:1, pink:1 }).forEach(k => {
    const btn = document.getElementById('theme-btn-' + k);
    if (!btn) return;
    btn.style.borderColor = k === name ? 'var(--accent)' : 'transparent';
    btn.style.background  = k === name ? 'var(--accent-bg)' : 'var(--bg3)';
  });
  // Prévisualiser immédiatement
  applyTheme(name);
  // Sauvegarder immédiatement sans attendre le bouton Enregistrer
  API.put('/settings', { theme: name }).catch(function(e) {
    console.error('[Theme] Erreur sauvegarde :', e.message);
  });
}

// ── Sauvegarder tous les paramètres ──────────────────────
async function saveSettings() {
  const togPrices    = document.getElementById('toggle-show-prices');
  const togLocs      = document.getElementById('toggle-show-locations');
  const body = {
    app_name:       document.getElementById('set-app-name')?.value,
    theme:          document.getElementById('set-theme')?.value || 'signal',
    color_mode:     document.getElementById('set-color-mode')?.value || '',
    dark_from:      document.getElementById('set-dark-from')?.value || '20',
    dark_to:        document.getElementById('set-dark-to')?.value || '7',
    show_prices:           togPrices   ? String(togPrices.dataset.enabled   === '1') : 'true',
    show_locations:        togLocs     ? String(togLocs.dataset.enabled     === '1') : 'true',
    stock_alert_enabled:        document.getElementById('toggle-stock-alert')?.dataset.enabled === '1' ? 'true' : 'false',
    stock_alert_threshold:      document.getElementById('set-stock-threshold')?.value || '20',
  };
  try {
    await API.put('/settings', body);
    toast('Paramètres sauvegardés', 'success');
    // Mettre à jour le nom dans la sidebar et le titre de la page
    const newName = body.app_name || 'FilaFlow';
    const logoEl  = document.querySelector('.logo-name');
    if (logoEl) logoEl.textContent = newName;
    document.title = newName;
    window._stockAlertEnabled   = body.stock_alert_enabled === 'true';
    window._stockAlertThreshold = parseInt(body.stock_alert_threshold) || 20;
  } catch (e) { toast(e.message, 'error'); }
}

// ── Backup ───────────────────────────────────────────────
function toggleBackup() {
  const toggle  = document.getElementById('backup-toggle');
  const config  = document.getElementById('backup-config');
  const listWrap= document.getElementById('backup-list-wrap');
  const dot     = toggle.querySelector('div');
  const enabled = dot.style.left === '2px';
  dot.style.left           = enabled ? '19px' : '2px';
  toggle.style.background  = enabled ? 'var(--accent)' : 'var(--border2)';
  config.style.display     = enabled ? 'block' : 'none';
  listWrap.style.display   = enabled ? 'block' : 'none';
  API.post('/backup/settings', { enabled }).catch(function(){});
  if (enabled) loadBackupStatus();
}

function toggleBackupDest(val) {
  document.getElementById('backup-local-config').style.display = val === 'local' ? 'block' : 'none';
  document.getElementById('backup-nas-config').style.display   = val === 'nas'   ? 'block' : 'none';
}

async function testNasConnection() {
  const btn = document.querySelector('[onclick="testNasConnection()"]');
  const result = document.getElementById('nas-test-result');
  if (btn) btn.disabled = true;
  if (result) result.textContent = 'Test en cours…';
  try {
    const r = await API.post('/backup/test-nas', {
      nasIp:      document.getElementById('set-nas-ip')?.value,
      nasShare:   document.getElementById('set-nas-share')?.value,
      nasUser:    document.getElementById('set-nas-user')?.value,
      nasPassword:document.getElementById('set-nas-password')?.value,
      nasFolder:  document.getElementById('set-nas-folder')?.value,
    });
    if (result) {
      result.textContent = r.ok ? '✓ ' + r.message : '✗ ' + r.message;
      result.style.color = r.ok ? 'var(--success)' : 'var(--danger)';
    }
  } catch(e) {
    if (result) { result.textContent = '✗ ' + e.message; result.style.color = 'var(--danger)'; }
  }
  if (btn) btn.disabled = false;
}

async function saveBackupSettings() {
  const destNas     = document.getElementById('backup-dest-nas')?.checked;
  const body = {
    enabled:        document.getElementById('backup-toggle').querySelector('div').style.left !== '2px',
    path:           document.getElementById('set-backup-path')?.value || '/opt/filaflow/backups',
    schedule:       document.getElementById('set-backup-schedule')?.value || '0 3 * * *',
    keep:           parseInt(document.getElementById('set-backup-keep')?.value) || 7,
    libraryEnabled: false,
    reportEmail:    false,
    destination:    destNas ? 'nas' : 'local',
    nasIp:          document.getElementById('set-nas-ip')?.value || '',
    nasShare:       document.getElementById('set-nas-share')?.value || '',
    nasUser:        document.getElementById('set-nas-user')?.value || '',
    nasPassword:    (function(){
      const v = document.getElementById('set-nas-password')?.value;
      return v || undefined; // undefined = ne pas écraser si vide
    })(),
    nasFolder:      document.getElementById('set-nas-folder')?.value || '/filaflow',
  };
  try {
    await API.post('/backup/settings', body);
    toast('Paramètres de sauvegarde enregistrés', 'success');
    loadBackupStatus();
  } catch(e) { toast(e.message, 'error'); }
}

async function runBackupNow() {
  const el = document.getElementById('backup-status-display');
  if (el) el.innerHTML = '<span style="color:var(--text3);font-size:13px">Sauvegarde en cours…</span>';
  try {
    const r = await API.post('/backup/run', {});
    if (r.ok && r.backup) {
      const rep = r.backup;
      const msg = rep.success
        ? 'Sauvegarde OK — ' + rep.stamp + ' (' + rep.duration + 's)'
        : 'Erreur : ' + rep.error;
      toast(msg, rep.success ? 'success' : 'error');
    }
    loadBackupStatus();
  } catch(e) { toast('Erreur sauvegarde : ' + e.message, 'error'); }
}

async function loadBackupStatus() {
  try {
    const status = await API.get('/backup/status');
    const el     = document.getElementById('backup-status-display');
    const listEl = document.getElementById('backup-list');
    const lastInfo = document.getElementById('backup-last-info');

    // Dernière sauvegarde
    if (lastInfo) {
      if (status.lastRun) {
        const ok = status.lastStatus === 'ok';
        lastInfo.innerHTML =
          '<span style="color:' + (ok ? 'var(--success)' : 'var(--danger)') + '">' +
          (ok ? '✓ Dernière sauvegarde : ' : '✗ Dernière tentative : ') +
          fmtDateTime(status.lastRun) + '</span>' +
          (status.nextBackup ? ' · <span style="color:var(--text3)">Prochaine : ' + fmtDateTime(status.nextBackup) + '</span>' : '') +
          (!ok && status.lastStatus ? '<br><span style="color:var(--danger);font-size:11px">' + status.lastStatus.replace('error:','') + '</span>' : '');
      } else if (status.nextBackup) {
        lastInfo.innerHTML = '<span style="font-size:12px;color:var(--text3)">Prochaine sauvegarde : ' + fmtDateTime(status.nextBackup) + '</span>';
      }
    }

    if (el) el.innerHTML = '';

    // Liste des sauvegardes (dossiers horodatés)
    if (listEl) {
      if (!status.backups || status.backups.length === 0) {
        listEl.innerHTML = '<span style="color:var(--text3);font-size:13px">Aucune sauvegarde disponible.</span>';
      } else {
        listEl.innerHTML = '<table><thead><tr>' +
          '<th>Date</th><th>Type</th><th>BDD</th><th>Photos</th><th>Biblio</th>' +
          '</tr></thead><tbody>' +
          status.backups.map(function(b) {
            const fmt = function(n) {
              if (!n) return '—';
              if (n < 1024) return n + ' o';
              if (n < 1048576) return Math.round(n/1024) + ' Ko';
              return (n/1048576).toFixed(1) + ' Mo';
            };
            const date = b.stamp ? b.stamp.replace('_', ' ') : b.stamp;
            return '<tr>' +
              '<td style="font-size:12px;font-family:monospace">' + date + '</td>' +
              '<td><span style="font-size:10px;padding:1px 6px;border-radius:10px;' +
                'background:var(--accent-bg);color:var(--accent)">' + (b.type||'Incrémentielle') + '</span></td>' +
              '<td style="font-size:12px">' + fmt(b.dbSize) + '</td>' +
              '<td style="font-size:12px">' + (b.photoCount > 0 ? b.photoCount + ' new' : '—') + '</td>' +
              '<td style="font-size:12px">' + (b.libCount > 0 ? b.libCount + ' new' : '—') + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table>';
      }
    }
  } catch(_) {}
}

async function deleteBackup(filename) {
  confirmDelete('Supprimer cette sauvegarde ?', async () => {
    try { await API.del('/backup/' + filename); toast('Sauvegarde supprimée'); loadBackupStatus(); }
    catch(e) { toast(e.message, 'error'); }
  });
}

async function exportFull() {
  const btn    = document.getElementById('btn-export-full');
  const status = document.getElementById('export-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = "Préparation de l'export…";

  try {
    // Déclencher le téléchargement directement via un lien
    const a = document.createElement('a');
    // Ajouter le token auth si nécessaire
    const token = localStorage.getItem('pf_auth_token') || '';
    a.href = '/api/backup/export-full' + (token ? '?token=' + encodeURIComponent(token) : '');
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (status) status.textContent = 'Export lancé — le téléchargement démarrera dans quelques secondes.';
    setTimeout(() => { if (status) status.textContent = ''; }, 8000);
  } catch(e) {
    toast('Erreur export : ' + e.message, 'error');
    if (status) status.textContent = '';
  } finally {
    if (btn) btn.disabled = false;
  }
}

function togglePwdVisibility(inputId, eyeId) {
  const input = document.getElementById(inputId);
  const eye   = document.getElementById(eyeId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  // Basculer l'icône œil / œil barré
  if (eye) {
    eye.innerHTML = isHidden
      ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>' +
        '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>' +
        '<line x1="1" y1="1" x2="23" y2="23"/>'
      : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}

async function saveAuthSettings() {
  const pwd     = document.getElementById('set-auth-password')?.value;
  const confirm = document.getElementById('set-auth-password-confirm')?.value;
  const enabled = document.getElementById('toggle-auth')?.dataset.enabled === '1';
  const msgEl   = document.getElementById('pwd-match-msg');

  // Vérification confirmation uniquement si le champ est rempli
  if (confirm && pwd !== confirm) {
    if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = 'var(--danger)'; msgEl.textContent = '⚠ Les mots de passe ne correspondent pas.'; }
    return;
  }
  if (msgEl) msgEl.style.display = 'none';

  if (enabled && !pwd) return toast('Définissez un mot de passe', 'error');
  try {
    await API.put('/settings', { auth_enabled: String(enabled), auth_password: pwd || '' });
    // Réinitialiser le champ de confirmation
    const confirmEl = document.getElementById('set-auth-password-confirm');
    if (confirmEl) confirmEl.value = '';
    toast('Paramètres de sécurité sauvegardés', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

// ── Restauration ─────────────────────────────────────────
function previewRestoreFile(input) {
  const file    = input.files[0];
  const preview = document.getElementById('restore-preview');
  const btn     = document.getElementById('btn-restore');
  const status  = document.getElementById('restore-status');
  if (status) status.textContent = '';
  if (!file) { if (btn) btn.disabled = true; return; }
  const size = file.size < 1048576 ? (file.size/1024).toFixed(0)+' Ko' : (file.size/1048576).toFixed(1)+' Mo';
  const type = file.name.endsWith('.tar.gz') ? 'Export complet (BDD + bibliothèque)' : 'Sauvegarde SQL';
  if (preview) preview.innerHTML =
    '<span style="color:var(--accent)">📄 ' + file.name + '</span>' +
    ' · ' + size + ' · ' + type;
  if (btn) btn.disabled = false;
}

async function doRestore() {
  const input  = document.getElementById('restore-file-input');
  const status = document.getElementById('restore-status');
  const btn    = document.getElementById('btn-restore');
  if (!input || !input.files.length) return;

  const file = input.files[0];
  const isFull = file.name.endsWith('.tar.gz');

  const msg = isFull
    ? 'Restaurer cet export complet ? La base de données ET la bibliothèque seront remplacées.'
    : 'Restaurer cette sauvegarde SQL ? La base de données sera remplacée par celle-ci.';

  if (!confirm('⚠ ' + msg + '\n\nCette action est irréversible. Continuer ?')) return;

  btn.disabled = true;
  if (status) { status.style.color = 'var(--text3)'; status.textContent = 'Restauration en cours…'; }

  const fd = new FormData();
  fd.append('backup', file);

  try {
    const resp = await fetch('/api/backup/restore', { method: 'POST', body: fd, headers: authHeaders() });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Erreur serveur');
    if (status) {
      status.style.color = 'var(--success)';
      status.textContent = '✓ ' + (data.message || 'Restauration réussie') +
        ' — La page va se recharger…';
    }
    setTimeout(function() { window.location.reload(); }, 2500);
  } catch(e) {
    if (status) { status.style.color = 'var(--danger)'; status.textContent = '❌ ' + e.message; }
    btn.disabled = false;
  }
}

async function restoreBackup(filename) {
  if (!confirm('Restaurer la sauvegarde "' + filename + '" ?\n\nLa base de données actuelle sera remplacée.')) return;
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--bg2);border:1px solid var(--border);' +
    'padding:12px 16px;border-radius:var(--radius);font-size:13px;z-index:9999;color:var(--text3)';
  status.textContent = 'Restauration en cours…';
  document.body.appendChild(status);
  try {
    // Télécharger le fichier puis le renvoyer en restore
    const dlResp = await fetch('/api/backup/download/' + filename, { headers: authHeaders() });
    const blob   = await dlResp.blob();
    const fd = new FormData();
    fd.append('backup', blob, filename);
    const resp = await fetch('/api/backup/restore', { method: 'POST', body: fd, headers: authHeaders() });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Erreur');
    status.style.color = 'var(--success)';
    status.textContent = '✓ ' + (data.message || 'Restauré') + ' — Rechargement…';
    setTimeout(function() { window.location.reload(); }, 2000);
  } catch(e) {
    status.style.color = 'var(--danger)';
    status.textContent = '❌ ' + e.message;
    setTimeout(function() { document.body.removeChild(status); }, 4000);
  }
}

// ── TigerTag Scale ───────────────────────────────────────
async function loadTigerTagRecent() {
  const el = document.getElementById('tigertag-recent');
  if (!el) return;
  try {
    const data = await API.get('/tigertag/status');
    if (!data.recent || !data.recent.length) {
      el.innerHTML = '<p style="font-size:12px;color:var(--text3)">Aucune pesée TigerTag Scale enregistrée.</p>';
      return;
    }
    el.innerHTML =
      '<div style="font-size:12px;font-weight:500;margin-bottom:8px;color:var(--text2)">Dernières pesées reçues</div>' +
      '<table><thead><tr><th>Date</th><th>Filament</th><th>Brut</th><th>Net</th></tr></thead><tbody>' +
      data.recent.map(function(w) {
        return '<tr>' +
          '<td style="font-size:11px;color:var(--text3);white-space:nowrap">' + fmtDateTime(w.created_at) + '</td>' +
          '<td style="font-size:12px">' +
            '<span style="display:inline-flex;align-items:center;gap:5px">' +
            '<span style="width:8px;height:8px;border-radius:50%;background:' + (w.color_hex||'#888') + ';display:inline-block"></span>' +
            w.filament_name + '</span>' +
          '</td>' +
          '<td style="font-size:12px">' + parseFloat(w.gross_weight).toFixed(0) + 'g</td>' +
          '<td style="font-size:12px;font-weight:500;color:var(--accent)">' + parseFloat(w.net_weight).toFixed(0) + 'g</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  } catch(_) {
    el.innerHTML = '<p style="font-size:12px;color:var(--text3)">TigerTag Scale non connecté.</p>';
  }
}

// ── Mode sombre ────────────────────────────────────────────────────────────
function previewColorMode(mode) {
  // Afficher/masquer les sélecteurs d'heure
  var wrap = document.getElementById('color-mode-time-wrap');
  if (wrap) wrap.style.display = mode === 'auto-time' ? 'flex' : 'none';
  // Prévisualiser immédiatement
  if (typeof applyColorMode === 'function') {
    var from = document.getElementById('set-dark-from')?.value || '20';
    var to   = document.getElementById('set-dark-to')?.value   || '7';
    applyColorMode(mode || null, from, to);
  }
}

// ── Base de référence poids bobines vides ─────────────────────────────────

async function loadSpoolWeights() {
  const el = document.getElementById('spool-weights-list');
  if (!el) return;
  try {
    const list = await API.get('/spool-weights');
    if (!list.length) {
      el.innerHTML = '<span style="color:var(--text3);font-size:13px">Aucune entrée.</span>';
      return;
    }
    // Grouper par fabricant
    const byBrand = {};
    list.forEach(function(s) {
      if (!byBrand[s.brand]) byBrand[s.brand] = [];
      byBrand[s.brand].push(s);
    });
    el.innerHTML = '<table><thead><tr>' +
      '<th>Fabricant</th><th>Modèle</th><th>Tare (g)</th><th>Taille bobine</th><th></th>' +
      '</tr></thead><tbody>' +
      list.map(function(s) {
        return '<tr>' +
          '<td style="font-weight:500">' + s.brand + '</td>' +
          '<td style="color:var(--text3)">' + (s.model||'—') + '</td>' +
          '<td style="font-weight:600;color:var(--accent)">' + s.weight_g + ' g</td>' +
          '<td style="font-size:12px;color:var(--text3)">' + (s.spool_size_g||1000) + ' g</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
            '<button class="btn btn-sm" onclick="editSpoolWeight(' + s.id + ')">✏</button> ' +
            '<button class="btn btn-sm btn-danger" onclick="deleteSpoolWeight(' + s.id + ')">✕</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  } catch(e) { if (el) el.innerHTML = '<span style="color:var(--danger)">' + e.message + '</span>'; }
}

function openAddSpoolWeight(existing) {
  const s = existing || {};
  openModal(
    '<div class="form-grid">' +
      '<div class="form-group">' +
        '<label class="form-label">Fabricant *</label>' +
        '<input id="sw-brand" value="' + (s.brand||'') + '" placeholder="ex: Bambu Lab">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Modèle</label>' +
        '<input id="sw-model" value="' + (s.model||'') + '" placeholder="ex: Standard AMS">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Poids bobine vide (g) *</label>' +
        '<input id="sw-weight" type="number" step="0.1" min="0" value="' + (s.weight_g||'') + '" placeholder="ex: 250">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Taille bobine (g de filament)</label>' +
        '<input id="sw-size" type="number" value="' + (s.spool_size_g||1000) + '">' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveSpoolWeight(' + (s.id||'null') + ')">' + (s.id ? 'Enregistrer' : 'Ajouter') + '</button>' +
    '</div>',
    s.id ? 'Modifier l\'entrée' : 'Ajouter un poids de référence'
  );
}

async function saveSpoolWeight(id) {
  const brand  = document.getElementById('sw-brand')?.value?.trim();
  const weight = document.getElementById('sw-weight')?.value;
  if (!brand || !weight) return toast('Fabricant et poids requis', 'error');
  const body = {
    brand,
    model:        document.getElementById('sw-model')?.value || null,
    weight_g:     parseFloat(weight),
    spool_size_g: parseInt(document.getElementById('sw-size')?.value) || 1000,
  };
  try {
    if (id) await API.put('/spool-weights/' + id, body);
    else     await API.post('/spool-weights', body);
    closeModal();
    toast(id ? 'Entrée mise à jour' : 'Entrée ajoutée', 'success');
    loadSpoolWeights();
  } catch(e) { toast(e.message, 'error'); }
}

async function editSpoolWeight(id) {
  const list = await API.get('/spool-weights');
  const s = list.find(function(x){ return x.id === id; });
  if (s) openAddSpoolWeight(s);
}

async function deleteSpoolWeight(id) {
  confirmDelete('Supprimer cette entrée de la base ?', async function() {
    await API.del('/spool-weights/' + id);
    toast('Entrée supprimée');
    loadSpoolWeights();
  });
}

// ── Santé système ─────────────────────────────────────────────────────────
async function loadSystemHealth() {
  const el = document.getElementById('system-health-content');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0">Chargement…</div>';

  try {
    const h = await API.get('/settings/system-health');

    const fmtBytes = function(b) {
      if (!b) return '—';
      if (b >= 1073741824) return (b/1073741824).toFixed(1) + ' Go';
      if (b >= 1048576)    return (b/1048576).toFixed(0) + ' Mo';
      return (b/1024).toFixed(0) + ' Ko';
    };

    const fmtUptime = function(s) {
      if (!s) return '—';
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (d > 0) return d + 'j ' + h + 'h ' + m + 'min';
      if (h > 0) return h + 'h ' + m + 'min';
      return m + 'min';
    };

    const bar = function(pct, color) {
      return '<div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">' +
        '<div style="height:100%;width:' + Math.min(100,pct) + '%;background:' + color + ';border-radius:3px;transition:width 0.3s"></div>' +
      '</div>';
    };

    const tempColor = !h.cpu_temp ? 'var(--text3)'
      : h.cpu_temp > 75 ? '#ef4444'
      : h.cpu_temp > 60 ? '#f59e0b'
      : '#10b981';

    const diskColor = !h.disk_pct ? 'var(--accent)'
      : h.disk_pct > 90 ? '#ef4444'
      : h.disk_pct > 75 ? '#f59e0b'
      : 'var(--accent)';

    const memColor = !h.mem_pct ? 'var(--accent)'
      : h.mem_pct > 85 ? '#ef4444'
      : h.mem_pct > 70 ? '#f59e0b'
      : 'var(--accent)';

    const serviceOk = h.service_status === 'active';

    el.innerHTML =
      // OS + réseau
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
        '<div class="stat-row"><span class="stat-label">Système</span><span class="stat-val" style="font-size:12px">' + (h.os||'—') + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">Node.js</span><span class="stat-val">' + (h.node_version||'—') + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">IP réseau</span><span class="stat-val">' + (h.ip||'—') + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">Service</span><span class="stat-val" style="color:' + (serviceOk?'#10b981':'#ef4444') + ';font-weight:600">' + (serviceOk?'✓ actif':'✗ ' + h.service_status) + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">Uptime</span><span class="stat-val">' + fmtUptime(h.uptime_s) + '</span></div>' +
        '<div class="stat-row"><span class="stat-label">Charge CPU (1m)</span><span class="stat-val">' + (h.load_1m !== null ? h.load_1m.toFixed(2) : '—') + '</span></div>' +
      '</div>' +

      // Température
      '<div style="margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
          '<span style="font-size:12px;color:var(--text3)">🌡 Température CPU</span>' +
          '<span style="font-size:13px;font-weight:600;color:' + tempColor + '">' + (h.cpu_temp !== null ? h.cpu_temp + ' °C' : '—') + '</span>' +
        '</div>' +
        (h.cpu_temp !== null ? bar(h.cpu_temp / 100 * 100, tempColor) : '') +
        (h.cpu_temp > 75 ? '<div style="font-size:11px;color:#ef4444;margin-top:3px">⚠ Température élevée — vérifiez le refroidissement</div>' : '') +
      '</div>' +

      // RAM
      '<div style="margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
          '<span style="font-size:12px;color:var(--text3)">🧠 Mémoire RAM</span>' +
          '<span style="font-size:13px;font-weight:600">' + fmtBytes(h.mem_used) + ' / ' + fmtBytes(h.mem_total) + '</span>' +
        '</div>' +
        bar(h.mem_pct || 0, memColor) +
        '<div style="font-size:11px;color:var(--text3);margin-top:3px">' + (h.mem_pct||0) + '% utilisé</div>' +
      '</div>' +

      // Disque
      '<div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
          '<span style="font-size:12px;color:var(--text3)">💾 Carte SD</span>' +
          '<span style="font-size:13px;font-weight:600">' + fmtBytes(h.disk_used) + ' / ' + fmtBytes(h.disk_total) + '</span>' +
        '</div>' +
        bar(h.disk_pct || 0, diskColor) +
        '<div style="font-size:11px;color:var(--text3);margin-top:3px">' + (h.disk_pct||0) + '% utilisé · ' + fmtBytes(h.disk_free) + ' libres' +
          (h.disk_pct > 90 ? ' <span style="color:#ef4444">⚠ Espace critique</span>' : '') +
        '</div>' +
      '</div>' +
      '';

  } catch(e) {
    if (el) el.innerHTML = '<div style="color:var(--danger);font-size:13px">Erreur : ' + e.message + '</div>';
  }
}

// ── Vérification et installation des mises à jour ────────────────────────
async function checkForUpdate() {
  const el = document.getElementById('update-check-content');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:4px 0">Vérification en cours…</div>';

  try {
    const info = await API.get('/updater/check');

    if (info.is_newer) {
      // Mise à jour disponible
      const pubDate = info.published_at
        ? new Date(info.published_at).toLocaleDateString('fr-FR', {day:'2-digit',month:'long',year:'numeric'})
        : '';

      // Formater les notes de release (markdown basique)
      const notes = (info.release_notes || '')
        .split('\n')
        .slice(0, 8)
        .map(function(l){ return l.replace(/^#+\s*/, '').replace(/\*\*/g,''); })
        .filter(function(l){ return l.trim(); })
        .join('<br>');

      el.innerHTML =
        '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:var(--radius);padding:14px;margin-bottom:12px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
            '<div>' +
              '<div style="font-size:15px;font-weight:600;color:#166534">✨ Mise à jour disponible !</div>' +
              '<div style="font-size:13px;color:#166534;margin-top:2px">' +
                'v' + info.current_version + ' → <strong>v' + info.latest_version + '</strong>' +
                (pubDate ? ' · ' + pubDate : '') +
              '</div>' +
            '</div>' +
            '<button class="btn btn-primary" onclick="installUpdate(\'' + info.latest_version + '\',\'' + info.download_url + '\')">' +
              '↓ Mettre à jour' +
            '</button>' +
          '</div>' +
          (notes ? '<div style="margin-top:10px;font-size:12px;color:#166534;border-top:1px solid #86efac;padding-top:10px">' + notes + '</div>' : '') +
        '</div>';
    } else {
      el.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;padding:4px 0">' +
          '<span style="color:#10b981;font-size:16px">✓</span>' +
          '<div>' +
            '<div style="font-size:13px;font-weight:500">Vous êtes à jour</div>' +
            '<div style="font-size:12px;color:var(--text3)">Version ' + info.current_version + ' · Dernière version : ' + info.latest_version + '</div>' +
          '</div>' +
        '</div>';
    }
  } catch(e) {
    el.innerHTML =
      '<div style="color:var(--danger);font-size:13px">' +
        '⚠ Impossible de vérifier : ' + e.message +
        '<br><span style="font-size:11px;color:var(--text3)">Vérifiez la connexion réseau du Pi.</span>' +
      '</div>';
  }
}

async function installUpdate(version, downloadUrl) {
  const confirmed = await new Promise(function(resolve) {
    openModal(
      '<div style="padding:8px 0">' +
        '<p style="font-size:14px;margin-bottom:12px">Vous allez installer la version <strong>' + version + '</strong>.</p>' +
        '<p style="font-size:13px;color:var(--text2);margin-bottom:8px">FilaFlow va redémarrer automatiquement. La mise à jour prend environ 30 secondes.</p>' +
        '<p style="font-size:12px;color:var(--text3)">⚠ La base de données ne sera pas modifiée automatiquement — consultez le CHANGELOG pour les éventuelles migrations SQL.</p>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn" onclick="closeModal()">Annuler</button>' +
        '<button class="btn btn-primary" onclick="closeModal();window._updateConfirmed=true">Installer</button>' +
      '</div>',
      'Confirmer la mise à jour v' + version
    );
    // Attendre confirmation
    const check = setInterval(function() {
      if (window._updateConfirmed) {
        window._updateConfirmed = false;
        clearInterval(check);
        resolve(true);
      }
      if (!document.getElementById('modal-overlay') || document.getElementById('modal-overlay').classList.contains('hidden')) {
        clearInterval(check);
        resolve(false);
      }
    }, 100);
  });

  if (!confirmed) return;

  const el = document.getElementById('update-check-content');
  if (el) el.innerHTML =
    '<div style="color:var(--text2);font-size:13px;padding:4px 0">' +
      '<div style="font-weight:500;margin-bottom:4px">⏳ Mise à jour en cours…</div>' +
      '<div style="font-size:12px;color:var(--text3)">Téléchargement et installation de la v' + version + '. FilaFlow va redémarrer dans quelques secondes.</div>' +
    '</div>';

  try {
    await API.post('/updater/update', { download_url: downloadUrl, latest_version: version });
    if (el) el.innerHTML =
      '<div style="color:#10b981;font-size:13px;padding:4px 0">' +
        '<div style="font-weight:500;margin-bottom:4px">✓ Mise à jour lancée !</div>' +
        '<div style="font-size:12px;color:var(--text3)">Rechargement de la page dans 15 secondes…</div>' +
      '</div>';
    // Recharger après redémarrage du service
    setTimeout(function() { window.location.reload(); }, 15000);
  } catch(e) {
    if (el) el.innerHTML = '<div style="color:var(--danger);font-size:13px">Erreur : ' + e.message + '</div>';
  }
}

// ── Logs d'erreurs backend ────────────────────────────────────────────────
async function loadBackendLogs() {
  const el = document.getElementById('backend-logs-content');
  if (!el) return;
  const level = document.getElementById('log-level-filter')?.value || '';
  try {
    const logs = await API.get('/logs' + (level ? '?level=' + level : ''));
    if (!logs.length) {
      el.innerHTML = '<div style="color:var(--success);font-size:13px;padding:4px 0">✓ Aucune erreur enregistrée</div>';
      return;
    }
    const levelColor = { error: '#ef4444', warn: '#f59e0b', info: '#3b82f6' };
    const levelIcon  = { error: '✗', warn: '⚠', info: 'ℹ' };
    el.innerHTML =
      '<div style="max-height:400px;overflow-y:auto;font-family:monospace">' +
      logs.map(function(l) {
        const col  = levelColor[l.level] || 'var(--text3)';
        const icon = levelIcon[l.level]  || '•';
        const time = new Date(l.ts).toLocaleString('fr-FR', {
          day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'
        });
        return '<div style="border-bottom:1px solid var(--border);padding:6px 0;display:flex;gap:8px;align-items:flex-start">' +
          '<span style="color:' + col + ';flex-shrink:0;font-size:12px">' + icon + '</span>' +
          '<span style="font-size:11px;color:var(--text3);flex-shrink:0;min-width:130px">' + time + '</span>' +
          '<span style="font-size:12px;color:' + col + ';word-break:break-all;white-space:pre-wrap">' +
            l.message.replace(/</g,'&lt;').replace(/>/g,'&gt;') +
          '</span>' +
        '</div>';
      }).join('') +
      '</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:8px">' + logs.length + ' entrée(s) · Les logs sont en mémoire et réinitialisés au redémarrage du service.</div>';
  } catch(e) {
    if (el) el.innerHTML = '<div style="color:var(--danger);font-size:13px">Erreur : ' + e.message + '</div>';
  }
}

async function clearBackendLogs() {
  try {
    await API.del('/logs');
    toast('Logs vidés', 'success');
    loadBackendLogs();
  } catch(e) { toast(e.message, 'error'); }
}

