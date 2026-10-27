/* Yurguen: Bitácora — captura + kanban (multi-acciones, fechas, espera) */
(function () {
  'use strict';

  var TOKEN_KEY = 'exha_bitacora_token';
  var USER_KEY = 'exha_bitacora_user';
  var CONDO_COLORS_KEY = 'exha_bitacora_show_condo_colors';
  var AUTH_API = '/api/eh-data';
  var FOCO_API = '/api/foco';

  var COLUMNS = [
    { status: 'inbox', label: 'Bandeja' },
    { status: 'hoy', label: 'Hoy' },
    { status: 'esperando', label: 'Esperando' },
    { status: 'despues', label: 'Después' },
    { status: 'hecho', label: 'Hecho' }
  ];

  var MAX_CONDOMINIOS = 11;

  /** Paleta pastel (hasta 11 condominios). */
  var CONDO_COLOR_PRESETS = [
    '#a8dadc', '#ffc8dd', '#bde0fe', '#caffbf', '#ffd6a5',
    '#e2cfea', '#f1c0e8', '#fdffb6', '#d0f4de', '#cddafd',
    '#fde2e4'
  ];

  var state = {
    user: null,
    data: {
      origenes: [],
      roles: [],
      formasPago: [],
      condominios: [],
      contactos: [],
      items: [],
      cajaMovimientos: []
    },
    modalMode: null,
    modalId: null,
    pendingMove: null,
    dragItemId: null,
    filters: { q: '', source: '', condoId: '' },
    cajaFilters: { desde: '', hasta: '', formaPagoId: '', condoId: '' },
    showCondoColors: true
  };

  var loginView = document.getElementById('focoLogin');
  var shell = document.getElementById('focoShell');
  var loginForm = document.getElementById('loginForm');
  var loginError = document.getElementById('loginError');
  var apiError = document.getElementById('apiError');
  var navButtons = document.querySelectorAll('[data-panel]');
  var panels = document.querySelectorAll('.foco-panel');
  var modalBackdrop = document.getElementById('modalBackdrop');
  var modalTitle = document.getElementById('modalTitle');
  var modalBody = document.getElementById('modalBody');
  var modalError = document.getElementById('modalError');
  var modalSave = document.getElementById('modalSave');
  var modalCancel = document.getElementById('modalCancel');
  var modalDelete = document.getElementById('modalDelete');
  var kanbanBoard = document.getElementById('kanbanBoard');

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function setSession(token, user) {
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

  function showModalError(msg) {
    if (!modalError) {
      if (msg) showApiError(msg);
      return;
    }
    modalError.hidden = !msg;
    modalError.textContent = msg || '';
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function todayIsoDate() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function formatDateLabel(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return iso;
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function actionText(a) {
    if (a == null) return '';
    if (typeof a === 'string') return String(a).trim();
    return String(a.text || '').trim();
  }

  function itemActions(it) {
    if (it.nextActions && it.nextActions.length) return it.nextActions.slice();
    if (it.nextAction && String(it.nextAction).trim()) {
      return [{ id: null, text: String(it.nextAction).trim(), done: false }];
    }
    return [];
  }

  function itemWaits(it) {
    if (it.waitFors && it.waitFors.length) return it.waitFors.slice();
    if (it.waitFor && String(it.waitFor).trim()) {
      return [{ id: null, text: String(it.waitFor).trim(), done: false }];
    }
    return [];
  }

  function mergeChecklistFromTexts(prevList, texts) {
    var prev = prevList || [];
    return texts.map(function (t) {
      var found = prev.find(function (a) { return actionText(a) === t; });
      if (found && found.id) {
        return { id: found.id, text: t, done: !!found.done };
      }
      return { text: t, done: false };
    });
  }

  function itemMatchesFilters(it) {
    var f = state.filters;
    if (f.source && it.source !== f.source) return false;
    if (f.condoId && it.condoId !== f.condoId) return false;
    if (f.q) {
      var q = f.q.toLowerCase();
      var blob = [
        it.title,
        it.body,
        itemActions(it).map(actionText).join(' '),
        itemWaits(it).map(actionText).join(' ')
      ].join(' ').toLowerCase();
      if (blob.indexOf(q) === -1) return false;
    }
    return true;
  }

  function renderChecklist(items, opts) {
    opts = opts || {};
    var listAttr = opts.list || 'nextActions';
    var itemId = opts.itemId || '';
    var canToggle = opts.canToggle !== false;
    if (!items.length) return '';
    var cls = opts.className || 'k-card__actions';
    return (
      '<ul class="' + cls + '">' +
      items.map(function (a) {
        var text = actionText(a);
        var done = !!(a && a.done);
        var aid = a && a.id ? a.id : '';
        var toggleOk = canToggle && !!aid;
        return (
          '<li class="' + (done ? 'is-done' : '') + '">' +
            (toggleOk
              ? '<label class="k-card__action-label">' +
                '<input type="checkbox" class="k-card__action-check" data-toggle-action="' + escapeHtml(aid) + '" data-item-id="' + escapeHtml(itemId) + '" data-list="' + escapeHtml(listAttr) + '"' + (done ? ' checked' : '') + ' />' +
                '<span>' + escapeHtml(text) + '</span></label>'
              : '<span class="k-card__action-static">' + (done ? '✓ ' : '→ ') + escapeHtml(text) + '</span>') +
          '</li>'
        );
      }).join('') +
      '</ul>'
    );
  }

  function post(url, action, body) {
    var payload = Object.assign({ action: action }, body || {});
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers['X-Session-Token'] = token;
    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) {
          var err = new Error((json && json.error) || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  function authApi(action, body) {
    return post(AUTH_API, action, body);
  }

  function focoApi(action, body) {
    return post(FOCO_API, action, body);
  }

  function switchPanel(name) {
    navButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-panel') === name);
    });
    panels.forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
  }

  function showLogin() {
    setSession('', null);
    state.data = { origenes: [], roles: [], condominios: [], contactos: [], items: [] };
    if (loginView) loginView.style.display = 'flex';
    if (shell) shell.classList.remove('active');
  }

  function showShell() {
    if (!state.user) loadSessionUser();
    if (loginView) loginView.style.display = 'none';
    if (shell) shell.classList.add('active');
    var label = document.getElementById('userLabel');
    if (label) label.textContent = (state.user && (state.user.displayName || state.user.username)) || '';
  }

  function applyData(data) {
    if (!data) return;
    state.data = {
      origenes: data.origenes || [],
      roles: data.roles || [],
      formasPago: data.formasPago || [],
      condominios: data.condominios || [],
      contactos: data.contactos || [],
      items: data.items || [],
      cajaMovimientos: data.cajaMovimientos || []
    };
    renderAll();
  }

  function origenName(id) {
    if (!id) return '';
    var o = (state.data.origenes || []).find(function (x) { return x.id === id; });
    if (o) return o.name;
    return String(id);
  }

  function condoName(id) {
    if (!id) return '';
    var c = state.data.condominios.find(function (x) { return x.id === id; });
    return c ? c.name : '';
  }

  function condoById(id) {
    if (!id) return null;
    return state.data.condominios.find(function (x) { return x.id === id; }) || null;
  }

  function condoColor(id) {
    var c = condoById(id);
    return c && c.color ? String(c.color) : '';
  }

  function normalizeHexColor(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (s.charAt(0) !== '#') s = '#' + s;
    if (!/^#[0-9a-fA-F]{6}$/.test(s)) return '';
    return s.toLowerCase();
  }

  function loadCondoColorPref() {
    try {
      var v = localStorage.getItem(CONDO_COLORS_KEY);
      if (v === null || v === undefined || v === '') {
        state.showCondoColors = true;
        return;
      }
      state.showCondoColors = v === '1' || v === 'true';
    } catch (e) {
      state.showCondoColors = true;
    }
  }

  function saveCondoColorPref(on) {
    state.showCondoColors = !!on;
    try {
      localStorage.setItem(CONDO_COLORS_KEY, state.showCondoColors ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  function syncCondoColorToggleUi() {
    var el = document.getElementById('toggleCondoColors');
    if (el) el.checked = !!state.showCondoColors;
    if (kanbanBoard) {
      kanbanBoard.classList.toggle('kanban--condo-colors', !!state.showCondoColors);
    }
  }

  function contactName(id) {
    if (!id) return '';
    var c = state.data.contactos.find(function (c) { return c.id === id; });
    return c ? c.name : '';
  }

  function roleName(id) {
    if (!id) return '';
    var r = (state.data.roles || []).find(function (x) { return x.id === id; });
    if (r) return r.name;
    return String(id);
  }

  function formaPagoName(id) {
    if (!id) return '';
    var f = (state.data.formasPago || []).find(function (x) { return x.id === id; });
    return f ? f.name : String(id);
  }

  function formatColones(n) {
    var v = Number(n) || 0;
    var neg = v < 0;
    var abs = Math.abs(v);
    var s = abs.toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return (neg ? '-₡' : '₡') + s;
  }

  function itemContactIds(it) {
    if (it.contactIds && it.contactIds.length) return it.contactIds.slice();
    if (it.contactId) return [it.contactId];
    return [];
  }

  function switchMaint(name) {
    document.querySelectorAll('.maint-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-maint') === name);
    });
    document.querySelectorAll('.maint-section').forEach(function (sec) {
      sec.classList.toggle('active', sec.id === 'maint-' + name);
    });
  }

  function findItem(id) {
    return (state.data.items || []).find(function (it) { return it.id === id; }) || null;
  }

  function itemsByStatus(status) {
    return (state.data.items || []).filter(function (it) { return it.status === status; });
  }

  function fillCondoSelects() {
    var condos = sortedCatalog(state.data.condominios);
    var sel = document.getElementById('capCondo');
    if (sel) {
      var cur = sel.value;
      sel.innerHTML = '<option value="">— Sin condominio —</option>';
      condos.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        sel.appendChild(opt);
      });
      if (cur) sel.value = cur;
    }
    var filt = document.getElementById('filterCondo');
    if (filt) {
      var curF = state.filters.condoId || filt.value;
      filt.innerHTML = '<option value="">Todos los condominios</option>';
      condos.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        filt.appendChild(opt);
      });
      filt.value = curF || '';
      state.filters.condoId = filt.value;
    }
  }

  function fillSourceSelects() {
    var origenes = sortedCatalog(state.data.origenes);
    var cap = document.getElementById('capSource');
    if (cap) {
      var cur = cap.value;
      cap.innerHTML = '';
      origenes.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.name;
        cap.appendChild(opt);
      });
      if (cur && origenes.some(function (o) { return o.id === cur; })) cap.value = cur;
      else if (origenes[0]) cap.value = origenes[0].id;
    }
    var filt = document.getElementById('filterSource');
    if (filt) {
      var curF = state.filters.source || filt.value;
      filt.innerHTML = '<option value="">Todos los orígenes</option>';
      origenes.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.name;
        filt.appendChild(opt);
      });
      filt.value = curF || '';
      state.filters.source = filt.value;
    }
  }

  function fillCapContacts(selectedIds) {
    var el = document.getElementById('capContacts');
    if (!el) return;
    var selected = selectedIds || [];
    var list = sortedCatalog(state.data.contactos);
    if (!list.length) {
      el.innerHTML = '<p class="check-list__empty">Sin contactos. Creálos en Mantenimientos.</p>';
      return;
    }
    el.innerHTML = list.map(function (c) {
      var checked = selected.indexOf(c.id) !== -1 ? ' checked' : '';
      var sub = condoName(c.condoId);
      return (
        '<label class="check-list__item">' +
          '<input type="checkbox" name="capContact" value="' + escapeHtml(c.id) + '"' + checked + ' />' +
          '<span>' + escapeHtml(c.name) + (sub ? ' <em>(' + escapeHtml(sub) + ')</em>' : '') + '</span>' +
        '</label>'
      );
    }).join('');
  }

  function readCheckedIds(containerId, inputName) {
    var root = document.getElementById(containerId);
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll('input[name="' + inputName + '"]:checked'))
      .map(function (inp) { return inp.value; });
  }

  function contactsCheckListHtml(selectedIds, containerId, inputName) {
    var selected = selectedIds || [];
    var list = sortedCatalog(state.data.contactos);
    if (!list.length) {
      return '<p class="check-list__empty">Sin contactos. Creálos en Mantenimientos.</p>';
    }
    return (
      '<div class="check-list" id="' + containerId + '">' +
      list.map(function (c) {
        var checked = selected.indexOf(c.id) !== -1 ? ' checked' : '';
        var sub = condoName(c.condoId);
        return (
          '<label class="check-list__item">' +
            '<input type="checkbox" name="' + inputName + '" value="' + escapeHtml(c.id) + '"' + checked + ' />' +
            '<span>' + escapeHtml(c.name) + (sub ? ' <em>(' + escapeHtml(sub) + ')</em>' : '') + '</span>' +
          '</label>'
        );
      }).join('') +
      '</div>'
    );
  }

  function updateBadge() {
    var n = itemsByStatus('inbox').length;
    var el = document.getElementById('inboxBadge');
    if (el) el.textContent = n + ' bandeja';
  }

  function renderCard(it) {
    var meta = [
      '<span class="k-card__source">' + escapeHtml(origenName(it.source)) + '</span>'
    ];
    var cn = condoName(it.condoId);
    var color = condoColor(it.condoId);
    if (cn) {
      meta.push(
        '<span class="k-card__condo">' +
          (color
            ? '<i class="k-card__condo-dot" style="background:' + escapeHtml(color) + '" aria-hidden="true"></i>'
            : '') +
          escapeHtml(cn) +
        '</span>'
      );
    }
    var cts = itemContactIds(it).map(contactName).filter(Boolean);
    if (cts.length) meta.push('<span>' + escapeHtml(cts.join(', ')) + '</span>');

    var actionHtml = renderChecklist(itemActions(it), {
      list: 'nextActions',
      itemId: it.id,
      canToggle: it.status !== 'hecho',
      className: 'k-card__actions'
    });

    var waits = itemWaits(it);
    var waitHtml = waits.length
      ? '<div class="k-card__waits"><span class="k-card__waits-label">Esperando</span>' +
        renderChecklist(waits, {
          list: 'waitFors',
          itemId: it.id,
          canToggle: it.status === 'esperando',
          className: 'k-card__actions k-card__actions--wait'
        }) +
        '</div>'
      : '';

    var dateHtml = '';
    if (it.status === 'hecho') {
      dateHtml =
        '<p class="k-card__date k-card__date--frozen">Cerrado: ' +
        escapeHtml(formatDateLabel(it.dueDate || '')) +
        '</p>';
    } else if (it.status === 'hoy' || it.status === 'despues') {
      dateHtml =
        '<label class="k-card__date-edit">Para ' +
        '<input type="date" class="k-card__date-input" data-due-item="' +
        escapeHtml(it.id) +
        '" value="' +
        escapeHtml(it.dueDate || '') +
        '" /></label>';
    } else if (it.dueDate) {
      dateHtml =
        '<p class="k-card__date">Para: ' +
        escapeHtml(formatDateLabel(it.dueDate)) +
        '</p>';
    }

    var bodyPreview = it.body
      ? '<p class="k-card__body">' + escapeHtml(it.body.length > 140 ? it.body.slice(0, 140) + '…' : it.body) + '</p>'
      : '';

    var colorAttr = color ? ' data-condo-color="' + escapeHtml(color) + '" style="--condo-color:' + escapeHtml(color) + '"' : '';

    return (
      '<article class="k-card' + (color ? ' k-card--condo-color' : '') + '" draggable="true" data-id="' +
        escapeHtml(it.id) + '" data-status="' + escapeHtml(it.status) + '"' + colorAttr + '>' +
        '<div class="k-card__meta">' + meta.join('') + '</div>' +
        '<h4 class="k-card__title">' + escapeHtml(it.title) + '</h4>' +
        actionHtml +
        waitHtml +
        dateHtml +
        bodyPreview +
        '<div class="k-card__foot">' +
          '<button type="button" class="btn btn-outline btn-sm" data-edit-contacts="' + escapeHtml(it.id) + '">Contactos</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-del-item="' + escapeHtml(it.id) + '">Eliminar</button>' +
        '</div>' +
      '</article>'
    );
  }

  function renderKanban() {
    syncCondoColorToggleUi();
    COLUMNS.forEach(function (col) {
      var zone = document.querySelector('[data-drop="' + col.status + '"]');
      var countEl = document.querySelector('[data-count="' + col.status + '"]');
      var list = itemsByStatus(col.status).filter(itemMatchesFilters);
      if (countEl) countEl.textContent = String(list.length);
      if (!zone) return;
      if (!list.length) {
        zone.innerHTML = '<p class="k-empty">Soltá acá</p>';
      } else {
        zone.innerHTML = list.map(renderCard).join('');
      }
    });
    bindCardDrag();
  }

  function syncFiltersFromUi() {
    var q = document.getElementById('filterQ');
    var src = document.getElementById('filterSource');
    var condo = document.getElementById('filterCondo');
    state.filters.q = q ? String(q.value || '').trim() : '';
    state.filters.source = src ? String(src.value || '') : '';
    state.filters.condoId = condo ? String(condo.value || '') : '';
    renderKanban();
  }

  function sortedCatalog(list) {
    return (list || []).slice().sort(function (a, b) {
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    });
  }

  function orderButtonsHtml(listName, id, index, total) {
    return (
      '<span class="order-btns">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-move-catalog="' + escapeHtml(listName) + '" data-id="' + escapeHtml(id) + '" data-dir="up"' + (index === 0 ? ' disabled' : '') + ' title="Subir">↑</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-move-catalog="' + escapeHtml(listName) + '" data-id="' + escapeHtml(id) + '" data-dir="down"' + (index >= total - 1 ? ' disabled' : '') + ' title="Bajar">↓</button>' +
      '</span>'
    );
  }

  function moveCatalogItem(listName, id, direction) {
    focoApi('moveCatalog', { list: listName, id: id, direction: direction })
      .then(function (res) {
        applyData(res.data);
        showApiError('');
      })
      .catch(function (err) {
        showApiError(err.message || 'No se pudo reordenar');
      });
  }

  function renderCondos() {
    var el = document.getElementById('listCondos');
    if (!el) return;
    var list = sortedCatalog(state.data.condominios);
    var countEl = document.getElementById('condoCount');
    if (countEl) countEl.textContent = '(' + list.length + '/' + MAX_CONDOMINIOS + ')';
    var btnNew = document.getElementById('btnNewCondo');
    if (btnNew) {
      btnNew.disabled = list.length >= MAX_CONDOMINIOS;
      btnNew.title = list.length >= MAX_CONDOMINIOS
        ? 'Máximo ' + MAX_CONDOMINIOS + ' condominios'
        : 'Nuevo condominio';
    }
    if (!list.length) {
      el.innerHTML = '<p class="empty-state">No hay condominios. Agregá el primero.</p>';
      return;
    }
    el.innerHTML = list.map(function (c, i) {
      var swatch = c.color
        ? '<span class="condo-swatch" style="background:' + escapeHtml(c.color) + '" title="' + escapeHtml(c.color) + '"></span>'
        : '';
      return (
        '<div class="condo-card">' +
          '<div><h3>' + swatch + escapeHtml(c.name) + '</h3>' +
          (c.notes ? '<p>' + escapeHtml(c.notes) + '</p>' : '') +
          '</div>' +
          '<div class="condo-card__actions">' +
            orderButtonsHtml('condominios', c.id, i, list.length) +
            '<button type="button" class="btn btn-outline btn-sm" data-edit-condo="' + escapeHtml(c.id) + '">Editar</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-del-condo="' + escapeHtml(c.id) + '">Borrar</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderContacts() {
    var el = document.getElementById('listContacts');
    if (!el) return;
    var list = sortedCatalog(state.data.contactos);
    if (!list.length) {
      el.innerHTML = '<p class="empty-state">Sin contactos. Agregá el primero.</p>';
      return;
    }
    el.innerHTML = list.map(function (c, i) {
      var sub = [roleName(c.roleId || c.role), condoName(c.condoId), c.phone].filter(Boolean).join(' · ');
      var extra = c.notes ? String(c.notes).trim() : '';
      return (
        '<div class="condo-card">' +
          '<div><h3>' + escapeHtml(c.name) + '</h3>' +
          (sub ? '<p>' + escapeHtml(sub) + '</p>' : '') +
          (extra ? '<p class="contact-extra">' + escapeHtml(extra) + '</p>' : '') +
          '</div>' +
          '<div class="condo-card__actions">' +
            orderButtonsHtml('contactos', c.id, i, list.length) +
            '<button type="button" class="btn btn-outline btn-sm" data-edit-contact="' + escapeHtml(c.id) + '">Editar</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-del-contact="' + escapeHtml(c.id) + '">Borrar</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderOrigenes() {
    var el = document.getElementById('listOrigenes');
    if (!el) return;
    var list = sortedCatalog(state.data.origenes);
    if (!list.length) {
      el.innerHTML = '<p class="empty-state">Sin orígenes.</p>';
      return;
    }
    el.innerHTML = list.map(function (o, i) {
      return (
        '<div class="condo-card">' +
          '<div><h3>' + escapeHtml(o.name) + '</h3></div>' +
          '<div class="condo-card__actions">' +
            orderButtonsHtml('origenes', o.id, i, list.length) +
            '<button type="button" class="btn btn-outline btn-sm" data-edit-origen="' + escapeHtml(o.id) + '">Editar</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-del-origen="' + escapeHtml(o.id) + '">Borrar</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderRoles() {
    var el = document.getElementById('listRoles');
    if (!el) return;
    var list = sortedCatalog(state.data.roles);
    if (!list.length) {
      el.innerHTML = '<p class="empty-state">Sin roles.</p>';
      return;
    }
    el.innerHTML = list.map(function (o, i) {
      return (
        '<div class="condo-card">' +
          '<div><h3>' + escapeHtml(o.name) + '</h3></div>' +
          '<div class="condo-card__actions">' +
            orderButtonsHtml('roles', o.id, i, list.length) +
            '<button type="button" class="btn btn-outline btn-sm" data-edit-role="' + escapeHtml(o.id) + '">Editar</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-del-role="' + escapeHtml(o.id) + '">Borrar</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderNamedCatalogList(elId, listName, editAttr, delAttr, emptyMsg) {
    var el = document.getElementById(elId);
    if (!el) return;
    var list = sortedCatalog(state.data[listName]);
    if (!list.length) {
      el.innerHTML = '<p class="empty-state">' + escapeHtml(emptyMsg) + '</p>';
      return;
    }
    el.innerHTML = list.map(function (o, i) {
      return (
        '<div class="condo-card">' +
          '<div><h3>' + escapeHtml(o.name) + '</h3></div>' +
          '<div class="condo-card__actions">' +
            orderButtonsHtml(listName, o.id, i, list.length) +
            '<button type="button" class="btn btn-outline btn-sm" data-' + editAttr + '="' + escapeHtml(o.id) + '">Editar</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-' + delAttr + '="' + escapeHtml(o.id) + '">Borrar</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderFormasPago() {
    renderNamedCatalogList('listFormasPago', 'formasPago', 'edit-forma-pago', 'del-forma-pago', 'Sin formas de pago.');
  }

  function syncCajaFiltersFromDom() {
    var desdeEl = document.getElementById('cajaFilterDesde');
    var hastaEl = document.getElementById('cajaFilterHasta');
    var formaEl = document.getElementById('cajaFilterForma');
    var condoEl = document.getElementById('cajaFilterCondo');
    state.cajaFilters.desde = desdeEl ? String(desdeEl.value || '') : '';
    state.cajaFilters.hasta = hastaEl ? String(hastaEl.value || '') : '';
    state.cajaFilters.formaPagoId = formaEl ? String(formaEl.value || '') : '';
    state.cajaFilters.condoId = condoEl ? String(condoEl.value || '') : '';
  }

  function fillCajaFilters() {
    var formaSel = document.getElementById('cajaFilterForma');
    var condoSel = document.getElementById('cajaFilterCondo');
    var desdeEl = document.getElementById('cajaFilterDesde');
    var hastaEl = document.getElementById('cajaFilterHasta');
    if (desdeEl && state.cajaFilters.desde) desdeEl.value = state.cajaFilters.desde;
    if (hastaEl && state.cajaFilters.hasta) hastaEl.value = state.cajaFilters.hasta;
    if (formaSel) {
      var curF = state.cajaFilters.formaPagoId || formaSel.value;
      formaSel.innerHTML = '<option value="">Todas las formas de pago</option>';
      sortedCatalog(state.data.formasPago).forEach(function (f) {
        formaSel.innerHTML +=
          '<option value="' + escapeHtml(f.id) + '"' + (curF === f.id ? ' selected' : '') + '>' +
          escapeHtml(f.name) + '</option>';
      });
      state.cajaFilters.formaPagoId = formaSel.value;
    }
    if (condoSel) {
      var curD = state.cajaFilters.condoId || condoSel.value;
      condoSel.innerHTML = '<option value="">Todos los condominios</option>';
      sortedCatalog(state.data.condominios).forEach(function (c) {
        condoSel.innerHTML +=
          '<option value="' + escapeHtml(c.id) + '"' + (curD === c.id ? ' selected' : '') + '>' +
          escapeHtml(c.name) + '</option>';
      });
      state.cajaFilters.condoId = condoSel.value;
    }
  }

  function filteredCajaMovs() {
    return (state.data.cajaMovimientos || []).filter(function (m) {
      if (m.tipo && m.tipo !== 'egreso') return false;
      var f = String(m.fecha || '').slice(0, 10);
      if (state.cajaFilters.desde && f < state.cajaFilters.desde) return false;
      if (state.cajaFilters.hasta && f > state.cajaFilters.hasta) return false;
      if (state.cajaFilters.formaPagoId && m.formaPagoId !== state.cajaFilters.formaPagoId) return false;
      if (state.cajaFilters.condoId && m.condoId !== state.cajaFilters.condoId) return false;
      return true;
    });
  }

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCajaCsv() {
    syncCajaFiltersFromDom();
    var list = filteredCajaMovs();
    if (!list.length) {
      showApiError('No hay egresos en el periodo/filtro para exportar');
      return;
    }
    var rows = [
      ['Fecha', 'Monto', 'Forma de pago', 'Condominio', 'Concepto'].join(',')
    ];
    list.forEach(function (m) {
      rows.push([
        csvEscape(m.fecha || ''),
        csvEscape(m.monto),
        csvEscape(formaPagoName(m.formaPagoId)),
        csvEscape(condoName(m.condoId)),
        csvEscape(m.concepto || '')
      ].join(','));
    });
    var blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var desde = state.cajaFilters.desde || 'inicio';
    var hasta = state.cajaFilters.hasta || 'hoy';
    a.href = url;
    a.download = 'caja-chica_' + desde + '_' + hasta + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showApiError('');
  }

  function renderCaja() {
    fillCajaFilters();
    var list = filteredCajaMovs();
    var egresos = 0;
    list.forEach(function (m) {
      egresos += Number(m.monto) || 0;
    });
    var egrEl = document.getElementById('cajaEgresos');
    if (egrEl) egrEl.textContent = formatColones(egresos);

    var el = document.getElementById('listCajaMovs');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<p class="empty-state">Sin egresos en este filtro. Registrá el primero o ampliá el periodo.</p>';
      return;
    }
    el.innerHTML = list.map(function (m) {
      var meta = [
        formatDateLabel(m.fecha),
        formaPagoName(m.formaPagoId),
        condoName(m.condoId)
      ].filter(Boolean).join(' · ');
      return (
        '<div class="caja-card caja-card--egreso">' +
          '<div class="caja-card__main">' +
            '<div class="caja-card__top">' +
              '<span class="caja-card__tipo">Egreso</span>' +
              '<strong class="caja-card__monto">' + formatColones(m.monto) + '</strong>' +
            '</div>' +
            (m.concepto ? '<p class="caja-card__concepto">' + escapeHtml(m.concepto) + '</p>' : '') +
            '<p class="caja-card__meta">' + escapeHtml(meta) + '</p>' +
          '</div>' +
          '<div class="caja-card__actions">' +
            '<button type="button" class="btn btn-outline btn-sm" data-edit-caja="' + escapeHtml(m.id) + '">Editar</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-del-caja="' + escapeHtml(m.id) + '">Borrar</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderAll() {
    var prevContacts = readCheckedIds('capContacts', 'capContact');
    fillSourceSelects();
    fillCondoSelects();
    fillCapContacts(prevContacts);
    updateBadge();
    renderKanban();
    renderCondos();
    renderOrigenes();
    renderRoles();
    renderContacts();
    renderFormasPago();
    renderCaja();
  }

  function loadData() {
    return focoApi('get').then(function (res) {
      applyData(res.data);
      showApiError('');
    });
  }

  function openModal(title, html, opts) {
    opts = opts || {};
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalDelete.hidden = !opts.showDelete;
    modalSave.textContent = opts.saveLabel || 'Guardar';
    showModalError('');
    modalBackdrop.hidden = false;
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    state.modalMode = null;
    state.modalId = null;
    state.pendingMove = null;
    modalBody.innerHTML = '';
    modalSave.textContent = 'Guardar';
    showModalError('');
  }

  function openCondoModal(condo) {
    state.modalMode = 'condo';
    state.modalId = condo ? condo.id : null;
    var color = condo && condo.color ? normalizeHexColor(condo.color) : '';
    var presets = CONDO_COLOR_PRESETS.map(function (hex) {
      return (
        '<button type="button" class="color-preset' + (color === hex ? ' is-active' : '') + '" data-condo-preset="' +
        escapeHtml(hex) + '" style="background:' + escapeHtml(hex) + '" title="' + escapeHtml(hex) + '" aria-label="Color ' +
        escapeHtml(hex) + '"></button>'
      );
    }).join('');
    openModal(
      condo ? 'Editar condominio' : 'Nuevo condominio',
      '<div class="field"><label>Nombre</label><input type="text" id="mCondoName" value="' + escapeHtml(condo ? condo.name : '') + '" required /></div>' +
      '<div class="field"><label>Color en el tablero</label>' +
        '<div class="condo-color-row">' +
          '<input type="color" id="mCondoColor" value="' + escapeHtml(color || CONDO_COLOR_PRESETS[0]) + '" />' +
          '<label class="check-inline"><input type="checkbox" id="mCondoColorClear"' + (color ? '' : ' checked') + ' /> Sin color</label>' +
        '</div>' +
        '<div class="color-presets" id="mCondoPresets">' + presets + '</div>' +
        '<p class="field-hint">Se usa en el kanban si activás “Colores de condo”.</p>' +
      '</div>' +
      '<div class="field"><label>Notas</label><textarea id="mCondoNotes" rows="3">' + escapeHtml(condo ? condo.notes : '') + '</textarea></div>',
      { showDelete: !!condo }
    );
    var colorInput = document.getElementById('mCondoColor');
    var clearChk = document.getElementById('mCondoColorClear');
    var presetsEl = document.getElementById('mCondoPresets');
    function markPreset(activeHex) {
      if (!presetsEl) return;
      presetsEl.querySelectorAll('.color-preset').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-condo-preset') === activeHex);
      });
    }
    if (colorInput) {
      colorInput.addEventListener('input', function () {
        if (clearChk) clearChk.checked = false;
        markPreset(normalizeHexColor(colorInput.value));
      });
    }
    if (clearChk) {
      clearChk.addEventListener('change', function () {
        if (clearChk.checked) markPreset('');
      });
    }
    if (presetsEl) {
      presetsEl.addEventListener('click', function (e) {
        var t = e.target;
        if (!(t instanceof Element)) return;
        var hex = t.getAttribute('data-condo-preset');
        if (!hex || !colorInput) return;
        colorInput.value = hex;
        if (clearChk) clearChk.checked = false;
        markPreset(hex);
      });
    }
  }

  function openContactModal(contact) {
    state.modalMode = 'contact';
    state.modalId = contact ? contact.id : null;
    var opts = sortedCatalog(state.data.condominios).map(function (c) {
      var sel = contact && contact.condoId === c.id ? ' selected' : '';
      return '<option value="' + escapeHtml(c.id) + '"' + sel + '>' + escapeHtml(c.name) + '</option>';
    }).join('');
    var roles = sortedCatalog(state.data.roles);
    var currentRole = contact ? (contact.roleId || contact.role) : (roles[0] && roles[0].id);
    var roleOpts = roles.map(function (r) {
      var sel = currentRole === r.id || currentRole === r.key || currentRole === r.name ? ' selected' : '';
      return '<option value="' + escapeHtml(r.id) + '"' + sel + '>' + escapeHtml(r.name) + '</option>';
    }).join('');
    openModal(
      contact ? 'Editar contacto' : 'Nuevo contacto',
      '<div class="field"><label>Nombre</label><input type="text" id="mCtName" value="' + escapeHtml(contact ? contact.name : '') + '" required /></div>' +
      '<div class="field"><label>Rol</label><select id="mCtRole">' +
        (roleOpts || '<option value="">— Sin roles —</option>') +
      '</select></div>' +
      '<div class="field"><label>Condominio</label><select id="mCtCondo"><option value="">—</option>' + opts + '</select></div>' +
      '<div class="field"><label>Teléfono</label><input type="text" id="mCtPhone" value="' + escapeHtml(contact ? contact.phone : '') + '" /></div>' +
      '<div class="field"><label>Información adicional</label><textarea id="mCtNotes" rows="3" placeholder="Correo, dirección, horarios, notas…">' +
        escapeHtml(contact ? (contact.notes || '') : '') + '</textarea></div>',
      { showDelete: !!contact }
    );
  }

  function openOrigenModal(origen) {
    state.modalMode = 'origen';
    state.modalId = origen ? origen.id : null;
    openModal(
      origen ? 'Editar origen' : 'Nuevo origen',
      '<div class="field"><label>Nombre</label><input type="text" id="mOrigenName" value="' + escapeHtml(origen ? origen.name : '') + '" required placeholder="Ej. WhatsApp, Visita…" /></div>',
      { showDelete: !!origen }
    );
  }

  function openRoleModal(role) {
    state.modalMode = 'role';
    state.modalId = role ? role.id : null;
    openModal(
      role ? 'Editar rol' : 'Nuevo rol',
      '<div class="field"><label>Nombre</label><input type="text" id="mRoleName" value="' + escapeHtml(role ? role.name : '') + '" required placeholder="Ej. Administrador, Portero…" /></div>',
      { showDelete: !!role }
    );
  }

  function openFormaPagoModal(fp) {
    state.modalMode = 'formaPago';
    state.modalId = fp ? fp.id : null;
    openModal(
      fp ? 'Editar forma de pago' : 'Nueva forma de pago',
      '<div class="field"><label>Nombre</label><input type="text" id="mFormaPagoName" value="' + escapeHtml(fp ? fp.name : '') + '" required placeholder="Ej. Sinpe, Tarjeta…" /></div>',
      { showDelete: !!fp }
    );
  }

  function openCajaMovModal(mov) {
    state.modalMode = 'cajaMov';
    state.modalId = mov ? mov.id : null;
    var formas = sortedCatalog(state.data.formasPago);
    var condos = sortedCatalog(state.data.condominios);
    var fpOpts = formas.map(function (f) {
      var sel = mov && mov.formaPagoId === f.id ? ' selected' : '';
      return '<option value="' + escapeHtml(f.id) + '"' + sel + '>' + escapeHtml(f.name) + '</option>';
    }).join('');
    var condoOpts = condos.map(function (c) {
      var sel = mov && mov.condoId === c.id ? ' selected' : '';
      return '<option value="' + escapeHtml(c.id) + '"' + sel + '>' + escapeHtml(c.name) + '</option>';
    }).join('');
    openModal(
      mov ? 'Editar egreso' : 'Nuevo egreso',
      '<div class="field-row">' +
        '<div class="field"><label>Monto</label><input type="number" id="mCajaMonto" min="0.01" step="0.01" value="' +
          escapeHtml(mov ? String(mov.monto) : '') + '" required /></div>' +
        '<div class="field"><label>Fecha</label><input type="date" id="mCajaFecha" value="' +
          escapeHtml(mov ? (mov.fecha || '') : todayIsoDate()) + '" required /></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Forma de pago</label><select id="mCajaFormaPago">' +
          (fpOpts || '<option value="">— Sin formas —</option>') +
        '</select></div>' +
        '<div class="field"><label>Condominio</label><select id="mCajaCondo"><option value="">—</option>' +
          condoOpts + '</select></div>' +
      '</div>' +
      '<div class="field"><label>Concepto</label><input type="text" id="mCajaConcepto" maxlength="200" value="' +
        escapeHtml(mov ? (mov.concepto || '') : '') + '" placeholder="Ej. Compra de materiales" /></div>',
      { showDelete: !!mov }
    );
  }

  function openItemContactsModal(item) {
    state.modalMode = 'itemContacts';
    state.modalId = item.id;
    openModal(
      'Contactos de la tarea',
      '<p class="panel-hint" style="margin-top:0">' + escapeHtml(item.title) + '</p>' +
      contactsCheckListHtml(itemContactIds(item), 'mItemContacts', 'mItemContact'),
      { showDelete: false, saveLabel: 'Guardar' }
    );
  }

  function checklistRowHtml(value, inputClass, placeholder) {
    return (
      '<div class="action-row">' +
        '<input type="text" class="' + inputClass + '" value="' + escapeHtml(value || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" />' +
        '<button type="button" class="btn btn-ghost btn-sm m-row-remove" title="Quitar">✕</button>' +
      '</div>'
    );
  }

  function bindChecklistRows(listId, addBtnId, inputClass, placeholder) {
    var list = document.getElementById(listId);
    var addBtn = document.getElementById(addBtnId);
    if (!list || !addBtn) return;
    addBtn.onclick = function () {
      list.insertAdjacentHTML('beforeend', checklistRowHtml('', inputClass, placeholder));
      var inputs = list.querySelectorAll('.' + inputClass);
      if (inputs.length) inputs[inputs.length - 1].focus();
    };
    list.onclick = function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      if (t.classList.contains('m-row-remove')) {
        var row = t.closest('.action-row');
        var rows = list.querySelectorAll('.action-row');
        if (row && rows.length > 1) row.remove();
        else if (row) {
          var inp = row.querySelector('.' + inputClass);
          if (inp) inp.value = '';
        }
      }
    };
  }

  function readChecklistInputs(listId, inputClass) {
    var list = document.getElementById(listId);
    if (!list) return [];
    return Array.prototype.slice.call(list.querySelectorAll('.' + inputClass))
      .map(function (inp) { return String(inp.value || '').trim(); })
      .filter(Boolean);
  }

  /** Modal al mover: acciones, pendientes de espera (varios), fecha Después */
  function openTriageModal(item, toStatus, opts) {
    opts = opts || {};
    state.modalMode = 'triage';
    state.pendingMove = {
      id: item.id,
      status: toStatus,
      clearWait: !!opts.clearWait
    };

    var actions = itemActions(item).map(actionText);
    if (!actions.length) actions = [''];
    var waits = itemWaits(item).map(actionText);
    if (!waits.length) waits = [''];

    var warnHtml = '';
    if (opts.clearWait && itemWaits(item).length) {
      warnHtml =
        '<p class="triage-warn">Al mover se van a <strong>eliminar</strong> los pendientes de espera:</p>' +
        '<ul class="triage-warn-list">' +
        itemWaits(item).map(function (w) {
          return '<li>' + escapeHtml(actionText(w)) + '</li>';
        }).join('') +
        '</ul>';
    }

    var needWait = toStatus === 'esperando';
    var needDate = toStatus === 'despues';
    // Siguientes acciones: opcionales (se muestran si ya hay o al triagear por otro motivo)
    var showActions = toStatus !== 'hecho' && (itemActions(item).length || needWait || needDate || opts.clearWait);

    var actionsBlock = showActions
      ? '<div class="field"><label>Siguientes acciones <span class="field-optional">(opcional)</span></label>' +
        '<div id="mActionsList">' + actions.map(function (t) {
          return checklistRowHtml(t, 'm-action-input', 'Ej. Llamar al fontanero');
        }).join('') + '</div>' +
        '<button type="button" class="btn btn-outline btn-sm" id="mAddAction" style="margin-top:8px">+ Otra acción</button></div>'
      : '';

    var waitsBlock = needWait
      ? '<div class="field"><label>Pendientes de espera</label>' +
        '<div id="mWaitsList">' + waits.map(function (t) {
          return checklistRowHtml(t, 'm-wait-input', 'Ej. Respuesta de la junta');
        }).join('') + '</div>' +
        '<button type="button" class="btn btn-outline btn-sm" id="mAddWait" style="margin-top:8px">+ Otro pendiente</button></div>'
      : '';

    openModal(
      'Antes de mover',
      '<p class="panel-hint" style="margin-top:0">Tarjeta: <strong>' + escapeHtml(item.title) + '</strong></p>' +
      warnHtml +
      actionsBlock +
      waitsBlock +
      (needDate
        ? '<div class="field"><label>Fecha (Después)</label>' +
          '<input type="date" id="mDueDate" value="' + escapeHtml(item.dueDate || '') + '" /></div>'
        : ''),
      { showDelete: false, saveLabel: 'Mover' }
    );
    bindChecklistRows('mActionsList', 'mAddAction', 'm-action-input', 'Ej. Llamar al fontanero');
    bindChecklistRows('mWaitsList', 'mAddWait', 'm-wait-input', 'Ej. Respuesta de la junta');
    setTimeout(function () {
      var first = document.querySelector('.m-action-input') || document.querySelector('.m-wait-input') || document.getElementById('mDueDate');
      if (first) first.focus();
    }, 50);
  }

  function executeMove(id, status, extra) {
    extra = extra || {};
    var payload = { id: id, status: status };
    if (extra.nextActions != null) payload.nextActions = extra.nextActions;
    if (extra.waitFors != null) payload.waitFors = extra.waitFors;
    if (extra.dueDate != null) payload.dueDate = extra.dueDate;
    return focoApi('moveItem', payload)
      .then(function (res) {
        applyData(res.data);
        showApiError('');
        closeModal();
      })
      .catch(function (err) {
        showApiError(err.message || 'No se pudo mover');
        renderKanban();
      });
  }

  function requestMove(itemId, toStatus) {
    var item = findItem(itemId);
    if (!item) return;
    if (item.status === toStatus) return;

    var leavingWait = item.status === 'esperando' && toStatus !== 'esperando' && itemWaits(item).length > 0;
    var needsWait = toStatus === 'esperando' && !itemWaits(item).length;
    var needsDate = toStatus === 'despues' && !item.dueDate;

    if (needsWait || needsDate || leavingWait) {
      openTriageModal(item, toStatus, { clearWait: leavingWait });
      return;
    }

    executeMove(itemId, toStatus, {
      dueDate: item.dueDate || null
    });
  }

  function bindCardDrag() {
    if (!kanbanBoard) return;
    kanbanBoard.querySelectorAll('.k-card').forEach(function (card) {
      card.addEventListener('dragstart', function (e) {
        if (e.target && e.target.closest && e.target.closest('.k-card__action-label, .k-card__foot, .k-card__date-edit, .k-card__date-input')) {
          e.preventDefault();
          return;
        }
        state.dragItemId = card.getAttribute('data-id');
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', state.dragItemId);
      });
      card.addEventListener('dragend', function () {
        card.classList.remove('is-dragging');
        state.dragItemId = null;
        kanbanBoard.querySelectorAll('.kanban-col__cards').forEach(function (z) {
          z.classList.remove('is-over');
        });
      });
    });
  }

  function bindDropZones() {
    if (!kanbanBoard) return;
    kanbanBoard.querySelectorAll('[data-drop]').forEach(function (zone) {
      zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('is-over');
      });
      zone.addEventListener('dragleave', function (e) {
        if (!zone.contains(e.relatedTarget)) zone.classList.remove('is-over');
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('is-over');
        var id = e.dataTransfer.getData('text/plain') || state.dragItemId;
        var to = zone.getAttribute('data-drop');
        if (id && to) requestMove(id, to);
      });
    });
  }

  navButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchPanel(btn.getAttribute('data-panel'));
    });
  });

  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      showLoginError('');
      authApi('auth', {
        username: document.getElementById('usernameInput').value,
        password: document.getElementById('passwordInput').value
      })
        .then(function (res) {
          if (!res.ok) {
            showLoginError(res.error || 'Credenciales inválidas');
            return;
          }
          setSession(res.token, res.user);
          showShell();
          switchPanel('tablero');
          return loadData();
        })
        .catch(function () {
          showLoginError('Abrí http://localhost:8080/bitacora (no el archivo directo).');
        });
    });
  }

  var btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', function () {
      authApi('logout').finally(function () {
        showLogin();
      });
    });
  }

  var captureForm = document.getElementById('captureForm');
  if (captureForm) {
    captureForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = document.getElementById('capTitle').value.trim();
      if (!title) return;
      focoApi('createItem', {
        title: title,
        body: document.getElementById('capBody').value,
        source: document.getElementById('capSource').value,
        condoId: document.getElementById('capCondo').value || null,
        contactIds: readCheckedIds('capContacts', 'capContact')
      })
        .then(function (res) {
          applyData(res.data);
          captureForm.reset();
          fillCapContacts([]);
          fillSourceSelects();
          showApiError('');
          switchPanel('tablero');
        })
        .catch(function (err) {
          showApiError(err.message || 'No se pudo guardar');
        });
    });
  }

  document.querySelectorAll('.maint-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchMaint(btn.getAttribute('data-maint'));
    });
  });

  var btnNewCondo = document.getElementById('btnNewCondo');
  if (btnNewCondo) {
    btnNewCondo.addEventListener('click', function () {
      if ((state.data.condominios || []).length >= MAX_CONDOMINIOS) {
        showApiError('Máximo ' + MAX_CONDOMINIOS + ' condominios');
        return;
      }
      openCondoModal(null);
    });
  }
  var btnNewOrigen = document.getElementById('btnNewOrigen');
  if (btnNewOrigen) btnNewOrigen.addEventListener('click', function () { openOrigenModal(null); });
  var btnNewRole = document.getElementById('btnNewRole');
  if (btnNewRole) btnNewRole.addEventListener('click', function () { openRoleModal(null); });
  var btnNewContact = document.getElementById('btnNewContact');
  if (btnNewContact) btnNewContact.addEventListener('click', function () { openContactModal(null); });
  var btnNewFormaPago = document.getElementById('btnNewFormaPago');
  if (btnNewFormaPago) btnNewFormaPago.addEventListener('click', function () { openFormaPagoModal(null); });
  var btnNewCajaMov = document.getElementById('btnNewCajaMov');
  if (btnNewCajaMov) btnNewCajaMov.addEventListener('click', function () { openCajaMovModal(null); });
  var btnCajaExport = document.getElementById('btnCajaExport');
  if (btnCajaExport) btnCajaExport.addEventListener('click', exportCajaCsv);

  var cajaFilterDesde = document.getElementById('cajaFilterDesde');
  var cajaFilterHasta = document.getElementById('cajaFilterHasta');
  var cajaFilterForma = document.getElementById('cajaFilterForma');
  var cajaFilterCondo = document.getElementById('cajaFilterCondo');
  var cajaFilterClear = document.getElementById('cajaFilterClear');
  function onCajaFilterChange() {
    syncCajaFiltersFromDom();
    renderCaja();
  }
  if (cajaFilterDesde) cajaFilterDesde.addEventListener('change', onCajaFilterChange);
  if (cajaFilterHasta) cajaFilterHasta.addEventListener('change', onCajaFilterChange);
  if (cajaFilterForma) cajaFilterForma.addEventListener('change', onCajaFilterChange);
  if (cajaFilterCondo) cajaFilterCondo.addEventListener('change', onCajaFilterChange);
  if (cajaFilterClear) {
    cajaFilterClear.addEventListener('click', function () {
      state.cajaFilters = { desde: '', hasta: '', formaPagoId: '', condoId: '' };
      if (cajaFilterDesde) cajaFilterDesde.value = '';
      if (cajaFilterHasta) cajaFilterHasta.value = '';
      if (cajaFilterForma) cajaFilterForma.value = '';
      if (cajaFilterCondo) cajaFilterCondo.value = '';
      renderCaja();
    });
  }

  var filterQ = document.getElementById('filterQ');
  var filterSource = document.getElementById('filterSource');
  var filterCondo = document.getElementById('filterCondo');
  var filterClear = document.getElementById('filterClear');
  var toggleCondoColors = document.getElementById('toggleCondoColors');
  if (filterQ) filterQ.addEventListener('input', syncFiltersFromUi);
  if (filterSource) filterSource.addEventListener('change', syncFiltersFromUi);
  if (filterCondo) filterCondo.addEventListener('change', syncFiltersFromUi);
  if (filterClear) {
    filterClear.addEventListener('click', function () {
      if (filterQ) filterQ.value = '';
      if (filterSource) filterSource.value = '';
      if (filterCondo) filterCondo.value = '';
      syncFiltersFromUi();
    });
  }
  if (toggleCondoColors) {
    toggleCondoColors.addEventListener('change', function () {
      saveCondoColorPref(toggleCondoColors.checked);
      syncCondoColorToggleUi();
      renderKanban();
    });
  }

  document.querySelector('.foco-main').addEventListener('change', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    var dueItemId = t.getAttribute('data-due-item');
    if (dueItemId) {
      var dueVal = String(t.value || '').trim();
      if (t.closest('[data-drop="despues"]') && !dueVal) {
        showApiError('En Después, poné una fecha');
        loadData();
        return;
      }
      focoApi('updateItem', { id: dueItemId, dueDate: dueVal || null })
        .then(function (res) {
          applyData(res.data);
          showApiError('');
        })
        .catch(function (err) {
          showApiError(err.message || 'No se pudo actualizar la fecha');
          loadData();
        });
      return;
    }
    var actionId = t.getAttribute('data-toggle-action');
    var itemId = t.getAttribute('data-item-id');
    var list = t.getAttribute('data-list') || 'nextActions';
    if (actionId && itemId && t.classList.contains('k-card__action-check')) {
      e.stopPropagation();
      focoApi('toggleAction', {
        id: itemId,
        actionId: actionId,
        list: list,
        done: !!t.checked
      })
        .then(function (res) {
          applyData(res.data);
          showApiError('');
        })
        .catch(function (err) {
          showApiError(err.message || 'No se pudo actualizar');
          t.checked = !t.checked;
        });
    }
  });

  document.querySelector('.foco-main').addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;

    if (t.closest && t.closest('.k-card__action-label')) {
      e.stopPropagation();
    }

    var moveCat = t.getAttribute('data-move-catalog');
    if (moveCat) {
      if (t.disabled) return;
      moveCatalogItem(moveCat, t.getAttribute('data-id'), t.getAttribute('data-dir'));
      return;
    }

    var editContacts = t.getAttribute('data-edit-contacts');
    if (editContacts) {
      var itemCt = findItem(editContacts);
      if (itemCt) openItemContactsModal(itemCt);
      return;
    }
    var delItem = t.getAttribute('data-del-item');
    if (delItem) {
      if (!confirm('¿Eliminar este ítem?')) return;
      focoApi('deleteItem', { id: delItem })
        .then(function (res) { applyData(res.data); showApiError(''); })
        .catch(function (err) { showApiError(err.message); });
      return;
    }
    var editCondo = t.getAttribute('data-edit-condo');
    if (editCondo) {
      var condo = state.data.condominios.find(function (c) { return c.id === editCondo; });
      if (condo) openCondoModal(condo);
      return;
    }
    var delCondo = t.getAttribute('data-del-condo');
    if (delCondo) {
      if (!confirm('¿Borrar condominio?')) return;
      focoApi('deleteCondo', { id: delCondo })
        .then(function (res) { applyData(res.data); showApiError(''); })
        .catch(function (err) { showApiError(err.message); });
      return;
    }
    var editOrigen = t.getAttribute('data-edit-origen');
    if (editOrigen) {
      var origen = state.data.origenes.find(function (o) { return o.id === editOrigen; });
      if (origen) openOrigenModal(origen);
      return;
    }
    var delOrigen = t.getAttribute('data-del-origen');
    if (delOrigen) {
      if (!confirm('¿Borrar origen? Las tareas con ese origen pasan al primero disponible.')) return;
      focoApi('deleteOrigen', { id: delOrigen })
        .then(function (res) { applyData(res.data); showApiError(''); })
        .catch(function (err) { showApiError(err.message); });
      return;
    }
    var editRole = t.getAttribute('data-edit-role');
    if (editRole) {
      var roleRow = state.data.roles.find(function (o) { return o.id === editRole; });
      if (roleRow) openRoleModal(roleRow);
      return;
    }
    var delRole = t.getAttribute('data-del-role');
    if (delRole) {
      if (!confirm('¿Borrar rol? Los contactos con ese rol pasan al primero disponible.')) return;
      focoApi('deleteRole', { id: delRole })
        .then(function (res) { applyData(res.data); showApiError(''); })
        .catch(function (err) { showApiError(err.message); });
      return;
    }
    var editFp = t.getAttribute('data-edit-forma-pago');
    if (editFp) {
      var fpRow = state.data.formasPago.find(function (o) { return o.id === editFp; });
      if (fpRow) openFormaPagoModal(fpRow);
      return;
    }
    var delFp = t.getAttribute('data-del-forma-pago');
    if (delFp) {
      if (!confirm('¿Borrar forma de pago? Los movimientos pasan a la primera disponible.')) return;
      focoApi('deleteFormaPago', { id: delFp })
        .then(function (res) { applyData(res.data); showApiError(''); })
        .catch(function (err) { showApiError(err.message); });
      return;
    }
    var editCaja = t.getAttribute('data-edit-caja');
    if (editCaja) {
      var cajaRow = (state.data.cajaMovimientos || []).find(function (m) { return m.id === editCaja; });
      if (cajaRow) openCajaMovModal(cajaRow);
      return;
    }
    var delCaja = t.getAttribute('data-del-caja');
    if (delCaja) {
      if (!confirm('¿Borrar este movimiento?')) return;
      focoApi('deleteCajaMov', { id: delCaja })
        .then(function (res) { applyData(res.data); showApiError(''); })
        .catch(function (err) { showApiError(err.message); });
      return;
    }
    var editCt = t.getAttribute('data-edit-contact');
    if (editCt) {
      var ct = state.data.contactos.find(function (c) { return c.id === editCt; });
      if (ct) openContactModal(ct);
      return;
    }
    var delCt = t.getAttribute('data-del-contact');
    if (delCt) {
      if (!confirm('¿Borrar contacto?')) return;
      focoApi('deleteContact', { id: delCt })
        .then(function (res) { applyData(res.data); showApiError(''); })
        .catch(function (err) { showApiError(err.message); });
    }
  });

  modalCancel.addEventListener('click', function () {
    closeModal();
    renderKanban();
  });
  modalBackdrop.addEventListener('click', function (e) {
    if (e.target === modalBackdrop) {
      closeModal();
      renderKanban();
    }
  });

  modalSave.addEventListener('click', function () {
    if (state.modalMode === 'triage' && state.pendingMove) {
      var to = state.pendingMove.status;
      var actions = readChecklistInputs('mActionsList', 'm-action-input');
      var waits = readChecklistInputs('mWaitsList', 'm-wait-input');
      var dueEl = document.getElementById('mDueDate');
      var due = dueEl ? String(dueEl.value || '').trim() : '';

      if (to === 'esperando' && !waits.length) {
        showApiError('Agregá al menos un pendiente de espera');
        return;
      }
      if (to === 'despues' && !due) {
        showApiError('Poné una fecha para Después');
        return;
      }
      if (state.pendingMove.clearWait) {
        var ok = confirm(
          'Al mover se eliminan los pendientes de espera.\n¿Seguro?'
        );
        if (!ok) return;
      }

      var itemRef = findItem(state.pendingMove.id);
      var payload = {
        dueDate: due || null
      };
      if (document.getElementById('mActionsList') && itemRef) {
        payload.nextActions = mergeChecklistFromTexts(itemActions(itemRef), actions);
      }
      if (document.getElementById('mWaitsList') && itemRef) {
        payload.waitFors = mergeChecklistFromTexts(itemWaits(itemRef), waits);
      }
      executeMove(state.pendingMove.id, to, payload);
      return;
    }
    if (state.modalMode === 'itemContacts' && state.modalId) {
      focoApi('updateItem', {
        id: state.modalId,
        contactIds: readCheckedIds('mItemContacts', 'mItemContact')
      })
        .then(function (res) {
          applyData(res.data);
          closeModal();
          showApiError('');
        })
        .catch(function (err) { showApiError(err.message); });
      return;
    }
    if (state.modalMode === 'condo') {
      var name = document.getElementById('mCondoName').value.trim();
      if (!name) return;
      var clearColor = document.getElementById('mCondoColorClear');
      var colorEl = document.getElementById('mCondoColor');
      var colorVal = '';
      if (!(clearColor && clearColor.checked) && colorEl) {
        colorVal = normalizeHexColor(colorEl.value);
      }
      focoApi('saveCondo', {
        id: state.modalId || undefined,
        name: name,
        notes: document.getElementById('mCondoNotes').value,
        color: colorVal || null
      })
        .then(function (res) {
          applyData(res.data);
          closeModal();
          showApiError('');
        })
        .catch(function (err) { showApiError(err.message); });
      return;
    }
    if (state.modalMode === 'origen') {
      var oNameEl = document.getElementById('mOrigenName');
      var oName = oNameEl ? String(oNameEl.value || '').trim() : '';
      if (!oName) {
        showModalError('Escribí el nombre del origen');
        return;
      }
      var origenPayload = { name: oName };
      if (state.modalId) origenPayload.id = state.modalId;
      focoApi('saveOrigen', origenPayload)
        .then(function (res) {
          applyData(res.data);
          closeModal();
          showApiError('');
          switchMaint('origenes');
        })
        .catch(function (err) {
          showModalError(err.message || 'No se pudo guardar el origen');
        });
      return;
    }
    if (state.modalMode === 'role') {
      var rNameEl = document.getElementById('mRoleName');
      var rName = rNameEl ? String(rNameEl.value || '').trim() : '';
      if (!rName) {
        showModalError('Escribí el nombre del rol');
        return;
      }
      var rolePayload = { name: rName };
      if (state.modalId) rolePayload.id = state.modalId;
      focoApi('saveRole', rolePayload)
        .then(function (res) {
          applyData(res.data);
          closeModal();
          showApiError('');
          switchMaint('roles');
        })
        .catch(function (err) {
          showModalError(err.message || 'No se pudo guardar el rol');
        });
      return;
    }
    if (state.modalMode === 'contact') {
      var ctName = document.getElementById('mCtName').value.trim();
      if (!ctName) {
        showModalError('Escribí el nombre del contacto');
        return;
      }
      var ctNotesEl = document.getElementById('mCtNotes');
      var ctPayload = {
        name: ctName,
        roleId: document.getElementById('mCtRole').value,
        condoId: document.getElementById('mCtCondo').value || null,
        phone: document.getElementById('mCtPhone').value,
        notes: ctNotesEl ? ctNotesEl.value : ''
      };
      if (state.modalId) ctPayload.id = state.modalId;
      focoApi('saveContact', ctPayload)
        .then(function (res) {
          applyData(res.data);
          closeModal();
          showApiError('');
          switchMaint('contactos');
        })
        .catch(function (err) {
          showModalError(err.message || 'No se pudo guardar el contacto');
        });
      return;
    }
    if (state.modalMode === 'formaPago') {
      var fpNameEl = document.getElementById('mFormaPagoName');
      var fpName = fpNameEl ? String(fpNameEl.value || '').trim() : '';
      if (!fpName) {
        showModalError('Escribí el nombre de la forma de pago');
        return;
      }
      var fpPayload = { name: fpName };
      if (state.modalId) fpPayload.id = state.modalId;
      focoApi('saveFormaPago', fpPayload)
        .then(function (res) {
          applyData(res.data);
          closeModal();
          showApiError('');
          switchMaint('formasPago');
        })
        .catch(function (err) {
          showModalError(err.message || 'No se pudo guardar la forma de pago');
        });
      return;
    }
    if (state.modalMode === 'cajaMov') {
      var montoEl = document.getElementById('mCajaMonto');
      var fechaEl = document.getElementById('mCajaFecha');
      var formaEl = document.getElementById('mCajaFormaPago');
      var condoEl = document.getElementById('mCajaCondo');
      var conceptoEl = document.getElementById('mCajaConcepto');
      var cajaPayload = {
        tipo: 'egreso',
        monto: montoEl ? montoEl.value : '',
        fecha: fechaEl ? fechaEl.value : '',
        formaPagoId: formaEl ? formaEl.value : '',
        condoId: condoEl && condoEl.value ? condoEl.value : null,
        concepto: conceptoEl ? conceptoEl.value : ''
      };
      if (state.modalId) cajaPayload.id = state.modalId;
      if (!cajaPayload.formaPagoId) {
        showModalError('Elegí una forma de pago (creala en Mantenimientos si falta)');
        return;
      }
      if (!cajaPayload.fecha) {
        showModalError('Poné la fecha');
        return;
      }
      focoApi('saveCajaMov', cajaPayload)
        .then(function (res) {
          applyData(res.data);
          closeModal();
          showApiError('');
          switchPanel('caja');
        })
        .catch(function (err) {
          showModalError(err.message || 'No se pudo guardar el egreso');
        });
    }
  });

  modalDelete.addEventListener('click', function () {
    if (state.modalMode === 'condo' && state.modalId) {
      if (!confirm('¿Borrar condominio?')) return;
      focoApi('deleteCondo', { id: state.modalId })
        .then(function (res) {
          applyData(res.data);
          closeModal();
        })
        .catch(function (err) { showApiError(err.message); });
      return;
    }
    if (state.modalMode === 'origen' && state.modalId) {
      if (!confirm('¿Borrar origen? Las tareas con ese origen pasan al primero disponible.')) return;
      focoApi('deleteOrigen', { id: state.modalId })
        .then(function (res) {
          applyData(res.data);
          closeModal();
        })
        .catch(function (err) { showModalError(err.message); });
      return;
    }
    if (state.modalMode === 'role' && state.modalId) {
      if (!confirm('¿Borrar rol? Los contactos con ese rol pasan al primero disponible.')) return;
      focoApi('deleteRole', { id: state.modalId })
        .then(function (res) {
          applyData(res.data);
          closeModal();
        })
        .catch(function (err) { showModalError(err.message); });
      return;
    }
    if (state.modalMode === 'contact' && state.modalId) {
      if (!confirm('¿Borrar contacto?')) return;
      focoApi('deleteContact', { id: state.modalId })
        .then(function (res) {
          applyData(res.data);
          closeModal();
        })
        .catch(function (err) { showApiError(err.message); });
      return;
    }
    if (state.modalMode === 'formaPago' && state.modalId) {
      if (!confirm('¿Borrar forma de pago? Los movimientos pasan a la primera disponible.')) return;
      focoApi('deleteFormaPago', { id: state.modalId })
        .then(function (res) {
          applyData(res.data);
          closeModal();
        })
        .catch(function (err) { showModalError(err.message); });
      return;
    }
    if (state.modalMode === 'cajaMov' && state.modalId) {
      if (!confirm('¿Borrar este movimiento?')) return;
      focoApi('deleteCajaMov', { id: state.modalId })
        .then(function (res) {
          applyData(res.data);
          closeModal();
        })
        .catch(function (err) { showModalError(err.message); });
    }
  });

  bindDropZones();

  loadCondoColorPref();
  syncCondoColorToggleUi();

  if (getToken() && loadSessionUser()) {
    authApi('me')
      .then(function (res) {
        if (!res.ok || !res.user) {
          showLogin();
          return;
        }
        setSession(getToken(), res.user);
        showShell();
        switchPanel('tablero');
        return loadData();
      })
      .catch(function () {
        showLogin();
      });
  } else {
    showLogin();
  }
})();
