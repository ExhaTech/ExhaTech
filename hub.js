/* Yurguen: Hub ExhaTech — login único, enlaces por permiso, admin usuarios */
(function () {
  'use strict';

  var TOKEN_KEY = 'exha_session_token';
  var USER_KEY = 'exha_session_user';
  var LEGACY_TOKEN_KEYS = ['exha_budget_token', 'exha_bitacora_token'];
  var LEGACY_USER_KEYS = ['exha_budget_user', 'exha_bitacora_user'];
  var API = (typeof location !== 'undefined' ? location.origin : '') + '/api/eh-data';

  var APPS = [
    {
      id: 'contabilidad',
      href: '/contabilidad',
      title: 'Contabilidad',
      desc: 'Presupuesto, ejecución y ciclos.'
    },
    {
      id: 'bitacora',
      href: '/bitacora',
      title: 'Bitácora',
      desc: 'Tablero, contactos y caja.'
    },
    {
      id: 'inventario',
      href: '/inventario',
      title: 'Inventario',
      desc: 'Productos, stock, compras y ventas.'
    }
  ];

  var state = {
    user: null,
    users: [],
    modalMode: null,
    modalId: null
  };

  var loginView = document.getElementById('hubLogin');
  var shell = document.getElementById('hubShell');
  var loginForm = document.getElementById('loginForm');
  var loginError = document.getElementById('loginError');
  var apiError = document.getElementById('apiError');
  var navButtons = document.querySelectorAll('[data-panel]');
  var panels = document.querySelectorAll('.admin-panel');
  var modalBackdrop = document.getElementById('modalBackdrop');
  var modalTitle = document.getElementById('modalTitle');
  var modalBody = document.getElementById('modalBody');
  var modalSave = document.getElementById('modalSave');
  var modalCancel = document.getElementById('modalCancel');
  var modalDelete = document.getElementById('modalDelete');

  function clearLegacySession() {
    LEGACY_TOKEN_KEYS.forEach(function (k) { sessionStorage.removeItem(k); });
    LEGACY_USER_KEYS.forEach(function (k) { sessionStorage.removeItem(k); });
  }

  function getToken() {
    var t = sessionStorage.getItem(TOKEN_KEY) || '';
    if (t) return t;
    for (var i = 0; i < LEGACY_TOKEN_KEYS.length; i++) {
      t = sessionStorage.getItem(LEGACY_TOKEN_KEYS[i]) || '';
      if (t) {
        sessionStorage.setItem(TOKEN_KEY, t);
        return t;
      }
    }
    return '';
  }

  function setSession(token, user) {
    clearLegacySession();
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
    if (user) {
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      state.user = user;
    } else {
      sessionStorage.removeItem(USER_KEY);
      state.user = null;
    }
  }

  function loadSessionUser() {
    try {
      var raw = sessionStorage.getItem(USER_KEY);
      if (!raw) {
        for (var i = 0; i < LEGACY_USER_KEYS.length; i++) {
          raw = sessionStorage.getItem(LEGACY_USER_KEYS[i]);
          if (raw) break;
        }
      }
      state.user = raw ? JSON.parse(raw) : null;
    } catch (e) {
      state.user = null;
    }
    return state.user;
  }

  function showLoginError(msg) {
    if (!loginError) return;
    loginError.textContent = msg || '';
    loginError.style.display = msg ? 'block' : 'none';
  }

  function showApiError(msg) {
    if (!apiError) return;
    apiError.hidden = !msg;
    apiError.textContent = msg || '';
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function api(action, body) {
    var payload = Object.assign({ action: action }, body || {});
    return fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': getToken()
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok || (json && json.error && !json.ok && res.status >= 400)) {
          var err = new Error((json && json.error) || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  function isAdminUser() {
    return !!(state.user && state.user.role === 'admin');
  }

  function userHasModule(name) {
    if (!state.user || isAdminUser()) return false;
    var m = state.user.modules || {};
    return !!m[name];
  }

  function switchPanel(name) {
    navButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-panel') === name);
    });
    panels.forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
  }

  function renderApps() {
    var grid = document.getElementById('appsGrid');
    var empty = document.getElementById('appsEmptyHint');
    if (!grid) return;

    if (isAdminUser()) {
      grid.innerHTML =
        '<div class="admin-card">' +
          '<h2 style="margin:0 0 6px">Administración</h2>' +
          '<p class="panel-hint" style="margin:0">Como admin solo gestionás usuarios y permisos. No operás Contabilidad, Bitácora ni Inventario.</p>' +
        '</div>';
      if (empty) empty.hidden = true;
      return;
    }

    var cards = APPS.filter(function (app) { return userHasModule(app.id); });
    if (!cards.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    grid.innerHTML = cards.map(function (app) {
      return '<a class="hub-card" href="' + app.href + '">' +
        '<h2>' + escapeHtml(app.title) + '</h2>' +
        '<p>' + escapeHtml(app.desc) + '</p>' +
      '</a>';
    }).join('');
  }

  function applyShellMode() {
    var admin = isAdminUser();
    var navUsers = document.getElementById('navUsuarios');
    var navApps = document.getElementById('navApps');
    if (navUsers) navUsers.hidden = !admin;
    if (navApps) navApps.hidden = false;
  }

  function showLogin() {
    setSession('', null);
    if (loginView) loginView.style.display = 'flex';
    if (shell) shell.classList.remove('active');
  }

  function showShell(opts) {
    opts = opts || {};
    if (!state.user) loadSessionUser();
    if (loginView) loginView.style.display = 'none';
    if (shell) shell.classList.add('active');
    var label = document.getElementById('userLabel');
    if (label && state.user) {
      label.textContent = state.user.displayName || state.user.username;
    }
    applyShellMode();
    showApiError('');
    var purgeEl = document.getElementById('purgeNotice');
    if (purgeEl) {
      if (opts.purgedInactive && opts.purgedInactive.length) {
        purgeEl.hidden = false;
        purgeEl.textContent =
          'Limpieza por inactividad (>31 días): se borraron datos de ' +
          opts.purgedInactive.map(function (p) { return p.username; }).join(', ') +
          '. Las cuentas siguen activas.';
      } else {
        purgeEl.hidden = true;
        purgeEl.textContent = '';
      }
    }
    renderApps();
    if (isAdminUser()) {
      switchPanel('usuarios');
      loadUsers();
    } else {
      switchPanel('apps');
    }
  }

  function openModal(title, bodyHtml, mode, id, canDelete) {
    state.modalMode = mode;
    state.modalId = id || null;
    if (modalTitle) modalTitle.textContent = title;
    if (modalBody) modalBody.innerHTML = bodyHtml;
    if (modalDelete) modalDelete.hidden = !canDelete;
    if (modalBackdrop) modalBackdrop.classList.add('open');
  }

  function closeModal() {
    state.modalMode = null;
    state.modalId = null;
    if (modalBackdrop) modalBackdrop.classList.remove('open');
  }

  function loadUsers() {
    return api('users.list').then(function (res) {
      state.users = res.users || [];
      renderUsers();
    }).catch(function (err) {
      showApiError(err.message || 'Error al cargar usuarios');
    });
  }

  function renderUsers() {
    var tbody = document.getElementById('usersBody');
    if (!tbody) return;
    if (!state.users.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Sin usuarios.</td></tr>';
      return;
    }
    tbody.innerHTML = state.users.map(function (u) {
      var st = u.active !== false ? 'Activo' : 'Inactivo';
      var badge = u.active !== false ? 'badge-paid' : 'badge-overdue';
      var mods = u.role === 'admin'
        ? '—'
        : [
            (u.modules && u.modules.contabilidad) ? 'Conta' : null,
            (u.modules && u.modules.bitacora) ? 'Bitácora' : null,
            (u.modules && u.modules.inventario) ? 'Inventario' : null
          ].filter(Boolean).join(', ') || 'Ninguno';
      return '<tr>' +
        '<td data-label="Usuario"><strong>' + escapeHtml(u.username) + '</strong><div class="panel-hint" style="margin:0">' +
          escapeHtml(u.displayName || '') + '</div></td>' +
        '<td data-label="Correo">' + escapeHtml(u.email || '—') +
          (u.phone ? '<div class="panel-hint" style="margin:0">' + escapeHtml(u.phone) + '</div>' : '') +
        '</td>' +
        '<td data-label="Módulos">' + escapeHtml(mods) + '</td>' +
        '<td data-label="Logins">' + (Number(u.loginCount) || 0) +
          (u.lastLoginAt ? '<div class="panel-hint" style="margin:0">' +
            escapeHtml(String(u.lastLoginAt).slice(0, 10)) + '</div>' : '') +
        '</td>' +
        '<td data-label="Estado"><span class="badge-status ' + badge + '">' + st + '</span></td>' +
        '<td data-label=""><button type="button" class="btn btn-outline btn-sm" data-edit-user="' + u.id + '">Editar</button></td></tr>';
    }).join('');
    tbody.querySelectorAll('[data-edit-user]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var u = state.users.find(function (x) { return x.id === btn.getAttribute('data-edit-user'); });
        if (u) openUserModal(u);
      });
    });
  }

  function openUserModal(user) {
    var u = user || {};
    var isEdit = !!user;
    var mods = u.modules || { contabilidad: true, bitacora: true, inventario: false };
    var isAdminRole = u.role === 'admin';
    openModal(
      isEdit ? 'Editar usuario' : 'Nuevo usuario',
      '<div class="field"><label>Usuario *</label><input id="mUsername" value="' + escapeHtml(u.username || '') + '" ' + (isEdit ? 'disabled' : '') + '></div>' +
      '<div class="field"><label>Nombre</label><input id="mDisplayName" value="' + escapeHtml(u.displayName || '') + '"></div>' +
      '<div class="field"><label>Correo *</label><input id="mEmail" type="email" value="' + escapeHtml(u.email || '') + '"></div>' +
      '<div class="field"><label>WhatsApp</label><input id="mPhone" type="tel" value="' + escapeHtml(u.phone || '') + '" placeholder="+506…"></div>' +
      '<div class="field"><label>Rol</label><select id="mRole">' +
      '<option value="user"' + (!isAdminRole ? ' selected' : '') + '>Usuario</option>' +
      '<option value="admin"' + (isAdminRole ? ' selected' : '') + '>Admin (solo gestión)</option></select></div>' +
      '<div class="field" id="mModulesWrap">' +
        '<label>Módulos</label>' +
        '<label class="check-inline"><input type="checkbox" id="mModConta"' + (mods.contabilidad !== false ? ' checked' : '') + '> Contabilidad</label> ' +
        '<label class="check-inline"><input type="checkbox" id="mModFoco"' + (mods.bitacora !== false ? ' checked' : '') + '> Bitácora</label> ' +
        '<label class="check-inline"><input type="checkbox" id="mModInv"' + (mods.inventario === true ? ' checked' : '') + '> Inventario</label>' +
      '</div>' +
      (isEdit
        ? '<p class="panel-hint">Logins: ' + (Number(u.loginCount) || 0) +
          (u.lastLoginAt ? ' · Último: ' + escapeHtml(String(u.lastLoginAt).slice(0, 16).replace('T', ' ')) : '') +
          '</p>' +
          '<div class="field"><label>Contraseña nueva <small>(vacío = no cambiar)</small></label><input id="mPassword" type="password" autocomplete="new-password"></div>' +
          '<button type="button" class="btn btn-outline btn-sm" id="btnTempPass" style="margin-bottom:10px">Generar clave temporal</button>' +
          '<div class="field"><label><input type="checkbox" id="mActive" ' + (u.active !== false ? 'checked' : '') + '> Activo</label></div>'
        : '<div class="field"><label>Contraseña *</label><input id="mPassword" type="password" autocomplete="new-password"></div>'),
      'user',
      u.id || null,
      isEdit && !(state.user && state.user.id === u.id)
    );
    var roleSel = document.getElementById('mRole');
    var modsWrap = document.getElementById('mModulesWrap');
    function syncModVisibility() {
      if (modsWrap) modsWrap.style.display = roleSel && roleSel.value === 'admin' ? 'none' : '';
    }
    if (roleSel) roleSel.addEventListener('change', syncModVisibility);
    syncModVisibility();
    var btnTemp = document.getElementById('btnTempPass');
    if (btnTemp && u.id) {
      btnTemp.addEventListener('click', function () {
        if (!confirm('¿Generar clave temporal? La actual deja de servir. Copiala ahora (aún no hay correo).')) return;
        api('users.issueTempPassword', { id: u.id })
          .then(function (res) {
            alert(
              'Clave temporal (copiá ahora):\n\n' + res.tempPassword +
              '\n\n' + (res.hint || '')
            );
            return loadUsers();
          })
          .catch(function (err) { alert(err.message || 'No se pudo generar'); });
      });
    }
  }

  function saveUserModal() {
    var username = document.getElementById('mUsername').value.trim().toLowerCase();
    var displayName = document.getElementById('mDisplayName').value.trim();
    var email = document.getElementById('mEmail').value.trim();
    var phone = document.getElementById('mPhone').value.trim();
    var role = document.getElementById('mRole').value;
    var password = document.getElementById('mPassword').value;
    var modules = {
      contabilidad: !!(document.getElementById('mModConta') && document.getElementById('mModConta').checked),
      bitacora: !!(document.getElementById('mModFoco') && document.getElementById('mModFoco').checked),
      inventario: !!(document.getElementById('mModInv') && document.getElementById('mModInv').checked)
    };
    if (state.modalId) {
      var payload = {
        id: state.modalId,
        displayName: displayName,
        email: email,
        phone: phone,
        role: role,
        modules: modules,
        active: document.getElementById('mActive').checked
      };
      if (password) payload.newPassword = password;
      api('users.update', payload)
        .then(function () { closeModal(); return loadUsers(); })
        .catch(function (err) { alert(err.message || 'Error al guardar'); });
    } else {
      if (!username || password.length < 6) {
        alert('Usuario y contraseña (mín. 6) obligatorios.');
        return;
      }
      if (role !== 'admin' && !email) {
        alert('Correo obligatorio para usuarios.');
        return;
      }
      api('users.create', {
        username: username,
        password: password,
        displayName: displayName || username,
        email: email,
        phone: phone,
        role: role,
        modules: modules,
        billingDayStart: 1
      })
        .then(function () { closeModal(); return loadUsers(); })
        .catch(function (err) { alert(err.message || 'Error al crear'); });
    }
  }

  function deleteUserModal() {
    if (!state.modalId) return;
    if (!confirm('¿Eliminar este usuario?')) return;
    api('users.delete', { id: state.modalId })
      .then(function () { closeModal(); return loadUsers(); })
      .catch(function (err) { alert(err.message || 'Error al eliminar'); });
  }

  function doLogin() {
    var userEl = document.getElementById('usernameInput');
    var passEl = document.getElementById('passwordInput');
    var username = userEl ? userEl.value.trim() : '';
    var password = passEl ? passEl.value : '';
    var btn = document.getElementById('loginBtn');
    if (!username || !password) {
      showLoginError('Completá usuario y contraseña.');
      return;
    }
    var btnText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
    showLoginError('Conectando...');
    api('auth', { username: username, password: password })
      .then(function (res) {
        if (!res.ok) {
          showLoginError(res.error || 'Credenciales inválidas');
          return;
        }
        setSession(res.token, res.user);
        showLoginError('');
        showShell({ purgedInactive: res.purgedInactive || [] });
      })
      .catch(function (err) {
        showLoginError(err.message || 'No se pudo conectar');
      })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = btnText; }
      });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      doLogin();
    });
  }

  function showRegisterError(msg) {
    var el = document.getElementById('registerError');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  function toggleAuthForms(showRegister) {
    if (loginForm) loginForm.hidden = !!showRegister;
    var reg = document.getElementById('registerForm');
    if (reg) reg.hidden = !showRegister;
    var btnReg = document.getElementById('btnShowRegister');
    if (btnReg) btnReg.hidden = !!showRegister;
  }

  var btnShowRegister = document.getElementById('btnShowRegister');
  if (btnShowRegister) {
    btnShowRegister.addEventListener('click', function () { toggleAuthForms(true); });
  }
  var btnShowLogin = document.getElementById('btnShowLogin');
  if (btnShowLogin) {
    btnShowLogin.addEventListener('click', function () { toggleAuthForms(false); });
  }
  var registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var username = (document.getElementById('regUsername').value || '').trim().toLowerCase();
      var email = (document.getElementById('regEmail').value || '').trim();
      var phone = (document.getElementById('regPhone').value || '').trim();
      var displayName = (document.getElementById('regDisplayName').value || '').trim();
      var password = document.getElementById('regPassword').value || '';
      var btn = document.getElementById('registerBtn');
      if (!username || password.length < 6) {
        showRegisterError('Usuario y contraseña (mín. 6) obligatorios.');
        return;
      }
      if (!email) {
        showRegisterError('Correo obligatorio.');
        return;
      }
      if (btn) btn.disabled = true;
      showRegisterError('Creando cuenta...');
      api('auth.register', {
        username: username,
        email: email,
        phone: phone,
        displayName: displayName || username,
        password: password
      })
        .then(function (res) {
          if (!res.ok) {
            showRegisterError(res.error || 'No se pudo registrar');
            return;
          }
          setSession(res.token, res.user);
          showRegisterError('');
          toggleAuthForms(false);
          showShell();
        })
        .catch(function (err) {
          showRegisterError(err.message || 'No se pudo registrar');
        })
        .finally(function () {
          if (btn) btn.disabled = false;
        });
    });
  }

  navButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var panel = btn.getAttribute('data-panel');
      switchPanel(panel);
      if (panel === 'usuarios' && isAdminUser()) loadUsers();
      if (panel === 'apps') renderApps();
    });
  });

  var btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', function () {
      api('logout').catch(function () { /* ignore */ }).finally(showLogin);
    });
  }

  var btnNewUser = document.getElementById('btnNewUser');
  if (btnNewUser) btnNewUser.addEventListener('click', function () { openUserModal(null); });

  if (modalSave) {
    modalSave.addEventListener('click', function () {
      if (state.modalMode === 'user') saveUserModal();
    });
  }
  if (modalCancel) modalCancel.addEventListener('click', closeModal);
  if (modalDelete) {
    modalDelete.addEventListener('click', function () {
      if (state.modalMode === 'user') deleteUserModal();
    });
  }
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', function (e) {
      if (e.target === modalBackdrop) closeModal();
    });
  }

  if (getToken()) {
    loadSessionUser();
    api('me')
      .then(function (res) {
        setSession(getToken(), res.user);
        showShell();
      })
      .catch(function () {
        showLogin();
      });
  } else {
    showLogin();
  }
})();
