/* Yurguen: Contabilidad — gráficos, catálogos, plan, ejecución, histórico */
(function () {
  'use strict';

  var TOKEN_KEY = 'exha_budget_token';
  var USER_KEY = 'exha_budget_user';
  var SUMMARY_CUR_KEY = 'exha_budget_summary_cur';
  var VIEW_CUR_KEY = 'exha_budget_view_cur';
  // Absoluto al origin actual (workers.dev o dominio custom).
  var API = (typeof location !== 'undefined' ? location.origin : '') + '/api/eh-data';

  var state = {
    user: null,
    users: [],
    budget: null,
    modalMode: null,
    modalId: null,
    modalLoanId: null,
    // Resumen: solo ₡ / $ (₡ por defecto)
    summaryCurrency: 'CRC',
    // Presupuesto + Ejecución: Oficial / ₡ / $ (Oficial por defecto)
    viewCurrency: 'OFFICIAL',
    // Filtros UI del panel Ejecución (no afectan totales del ciclo)
    exeFilters: {
      desde: '',
      hasta: '',
      categoryId: '',
      planLineId: '',
      paymentTypeId: ''
    }
  };

  var loginView = document.getElementById('adminLogin');
  var shell = document.getElementById('adminShell');
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

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function formatMoney(n) {
    var num = Number(n) || 0;
    return '₡' + num.toLocaleString('es-CR', { maximumFractionDigits: 2 });
  }

  function formatUsd(n) {
    var num = Number(n) || 0;
    return '$' + num.toLocaleString('es-CR', { maximumFractionDigits: 2 });
  }

  /** Resumen: montos en ₡ o $ según summaryCurrency */
  function formatChartMoney(crcAmount) {
    var crc = Number(crcAmount) || 0;
    if (state.summaryCurrency === 'USD') {
      var rate = currentFxRate();
      if (!(rate > 0)) return '$—';
      return formatUsd(crc / rate);
    }
    return formatMoney(crc);
  }

  /** Totales de Presupuesto/Ejecución: ₡ o $ (Oficial → ₡ agregados) */
  function formatViewMoney(crcAmount) {
    var crc = Number(crcAmount) || 0;
    if (state.viewCurrency === 'USD') {
      var rate = currentFxRate();
      if (!(rate > 0)) return '$—';
      return formatUsd(crc / rate);
    }
    return formatMoney(crc);
  }

  function chartUnitLabel() {
    return state.summaryCurrency === 'USD' ? '$' : '₡';
  }

  function syncCurrencyToggles() {
    document.querySelectorAll('[data-summary-cur]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-summary-cur') === state.summaryCurrency);
    });
    document.querySelectorAll('[data-view-cur]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view-cur') === state.viewCurrency);
    });
  }

  function setSummaryCurrency(cur) {
    state.summaryCurrency = cur === 'USD' ? 'USD' : 'CRC';
    sessionStorage.setItem(SUMMARY_CUR_KEY, state.summaryCurrency);
    syncCurrencyToggles();
    if (state.budget) {
      renderResumenCharts();
    }
  }

  function setViewCurrency(cur) {
    if (cur === 'USD') state.viewCurrency = 'USD';
    else if (cur === 'OFFICIAL') state.viewCurrency = 'OFFICIAL';
    else state.viewCurrency = 'CRC';
    sessionStorage.setItem(VIEW_CUR_KEY, state.viewCurrency);
    syncCurrencyToggles();
    if (state.budget) {
      renderPanelTotals();
      renderPlan();
      renderExecution();
    }
  }

  /**
   * Badge = moneda oficial (digitada).
   * Principal = toggle de Presupuesto/Ejecución (Oficial / ₡ / $).
   * Paréntesis = la otra moneda.
   */
  function formatPlanLineDisplay(amount, currency, type) {
    var rate = currentFxRate();
    var official = normalizeCur(currency);
    var n = Number(amount) || 0;
    var crc = toCrcLocal(n, official, rate);
    var mode = state.viewCurrency;
    var amtCls = type === 'income' ? 'amount--income' : 'amount--expense';

    if (!(rate > 0) && (official === 'USD' || mode === 'USD')) {
      return '<span class="amount-with-cur">' + currencyBadge(official) +
        '<span class="' + amtCls + '">Definí el TC</span></span>';
    }

    var mainText;
    var parenText;
    if (mode === 'OFFICIAL') {
      mainText = formatAmount(n, official);
      if (!(rate > 0)) {
        parenText = '—';
      } else if (official === 'USD') {
        parenText = formatMoney(crc);
      } else {
        parenText = formatUsd(crc / rate);
      }
    } else if (mode === 'USD') {
      mainText = formatUsd(rate > 0 ? crc / rate : 0);
      parenText = formatMoney(crc);
    } else {
      mainText = formatMoney(crc);
      parenText = rate > 0 ? formatUsd(crc / rate) : '$—';
    }

    return '<span class="amount-with-cur" title="Oficial: ' + escapeHtml(formatAmount(n, official)) + '">' +
      currencyBadge(official) +
      '<span class="' + amtCls + '">' + mainText + '</span>' +
      '<span class="plan-line-orig">(' + parenText + ')</span></span>';
  }

  function normalizeCur(currency) {
    return String(currency || 'CRC').toUpperCase() === 'USD' ? 'USD' : 'CRC';
  }

  function currencyBadge(currency) {
    var cur = normalizeCur(currency);
    if (cur === 'USD') {
      return '<span class="cur-badge cur-badge--usd" title="Dólares">$</span>';
    }
    return '<span class="cur-badge cur-badge--crc" title="Colones">₡</span>';
  }

  function formatAmount(amount, currency) {
    var num = Number(amount) || 0;
    var cur = normalizeCur(currency);
    if (cur === 'USD') {
      return '$' + num.toLocaleString('es-CR', { maximumFractionDigits: 2 });
    }
    return formatMoney(num);
  }

  function formatAmountWithBadge(amount, currency, type) {
    var cls = type === 'income' ? 'amount--income' : (type === 'expense' ? 'amount--expense' : '');
    return '<span class="amount-with-cur">' + currencyBadge(currency) +
      '<span class="' + cls + '">' + formatAmount(amount, currency) + '</span></span>';
  }

  function typeBadge(type) {
    if (type === 'income') {
      return '<span class="type-badge type-badge--income">Ingreso</span>';
    }
    return '<span class="type-badge type-badge--expense">Egreso</span>';
  }

  function rowTypeClass(type) {
    return type === 'income' ? 'row--income' : 'row--expense';
  }

  var CAT_COLLAPSE_KEY = 'exha_budget_cat_collapsed';

  function loadCollapsedMap() {
    try {
      return JSON.parse(sessionStorage.getItem(CAT_COLLAPSE_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function saveCollapsedMap(map) {
    sessionStorage.setItem(CAT_COLLAPSE_KEY, JSON.stringify(map || {}));
  }

  function isCatCollapsed(catId) {
    return !!loadCollapsedMap()[catId];
  }

  function setCatCollapsed(catId, collapsed) {
    var map = loadCollapsedMap();
    if (collapsed) map[catId] = true;
    else delete map[catId];
    saveCollapsedMap(map);
  }

  /** Orden manual (sortOrder); desempate por nombre */
  function sortedCategories() {
    return ((state.budget && state.budget.categories) || []).slice().sort(function (a, b) {
      var ao = Number(a.sortOrder);
      var bo = Number(b.sortOrder);
      if (isNaN(ao)) ao = 9999;
      if (isNaN(bo)) bo = 9999;
      if (ao !== bo) return ao - bo;
      return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
    });
  }

  /** Opciones: ingresos primero, egresos después; dentro de cada tipo usa sortOrder */
  function categoryOptionsHtml(selectedId) {
    var cats = sortedCategories().slice().sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'income' ? -1 : 1;
      var ao = Number(a.sortOrder);
      var bo = Number(b.sortOrder);
      if (isNaN(ao)) ao = 9999;
      if (isNaN(bo)) bo = 9999;
      if (ao !== bo) return ao - bo;
      return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
    });
    var html = '';
    var lastGroup = null;
    cats.forEach(function (c) {
      var group = c.type === 'income' ? '— Ingresos —' : '— Egresos —';
      if (group !== lastGroup) {
        html += '<option disabled>' + group + '</option>';
        lastGroup = group;
      }
      var mark = c.type === 'income' ? '↑' : '↓';
      html += '<option value="' + c.id + '"' + (selectedId === c.id ? ' selected' : '') + '>' +
        mark + ' ' + escapeHtml(c.name) + '</option>';
    });
    return html;
  }

  function planLinesForCategory(categoryId) {
    var lines = ((state.budget && state.budget.period && state.budget.period.budget) || [])
      .filter(function (l) { return l.categoryId === categoryId; })
      .slice()
      .sort(function (a, b) {
        var ao = Number(a.sortOrder);
        var bo = Number(b.sortOrder);
        if (isNaN(ao)) ao = 9999;
        if (isNaN(bo)) bo = 9999;
        if (ao !== bo) return ao - bo;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
    return lines;
  }

  function planLineLabel(line) {
    if (!line) return '—';
    var tag = String(line.tag || line.label || line.planLabel || '').trim();
    var amt = formatAmount(line.planned, line.currency);
    return tag ? (tag + ' · ' + amt) : ('Sin etiqueta · ' + amt);
  }

  function planLineName(exOrId) {
    if (exOrId && typeof exOrId === 'object') {
      var lines = ((state.budget && state.budget.period && state.budget.period.budget) || []);
      var found = lines.find(function (l) { return l.id === exOrId.planLineId; });
      if (found) {
        var tag = String(found.tag || found.label || found.planLabel || '').trim();
        return tag || 'Sin etiqueta';
      }
      return exOrId.planLineTag || '—';
    }
    return '—';
  }

  function planLineOptionsHtml(categoryId, selectedId) {
    var lines = planLinesForCategory(categoryId);
    var opts = '<option value="">— Sin línea —</option>';
    lines.forEach(function (line) {
      var sel = selectedId && line.id === selectedId ? ' selected' : '';
      opts += '<option value="' + escapeHtml(line.id) + '"' + sel + '>' +
        escapeHtml(planLineLabel(line)) + '</option>';
    });
    return opts;
  }

  function refreshExePlanLineOptions(keepSelectedId) {
    var catSel = document.getElementById('mExeCat');
    var planSel = document.getElementById('mExePlan');
    if (!catSel || !planSel) return;
    var selected = keepSelectedId != null ? keepSelectedId : planSel.value;
    planSel.innerHTML = planLineOptionsHtml(catSel.value, selected);
    if (selected && !Array.prototype.some.call(planSel.options, function (o) { return o.value === selected; })) {
      planSel.value = '';
    }
  }

  function movePlanLine(lineId, direction) {
    if (periodLocked()) {
      alert(lockMessage());
      return;
    }
    api('budget.plan.move', {
      id: lineId,
      direction: direction,
      cycleKey: currentCycleKey()
    })
      .then(function () { return loadBudget(); })
      .catch(function (err) { alert(err.message); });
  }

  function categoryStatsCrc(categoryId) {
    var rate = currentFxRate();
    var planned = 0;
    var actual = 0;
    planLinesForCategory(categoryId).forEach(function (line) {
      planned += toCrcLocal(line.planned, line.currency, rate);
    });
    ((state.budget && state.budget.period && state.budget.period.executions) || []).forEach(function (ex) {
      if (ex.categoryId !== categoryId) return;
      actual += toCrcLocal(ex.amount, ex.currency, rate);
    });
    return { planned: planned, actual: actual, remaining: planned - actual };
  }

  function toCrcLocal(amount, currency, rate) {
    var n = Number(amount) || 0;
    if (String(currency || 'CRC').toUpperCase() === 'USD') {
      return n * (Number(rate) || 0);
    }
    return n;
  }

  function periodIsClosed() {
    return !!(state.budget && (state.budget.periodClosed || (state.budget.period && state.budget.period.status === 'closed')));
  }

  function periodIsExpired() {
    if (periodIsClosed()) return false;
    if (state.budget && state.budget.periodExpired) return true;
    var p = state.budget && state.budget.period;
    if (!p || !p.endDate) return false;
    var today = new Date();
    var iso = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    return String(p.endDate) < iso;
  }

  /** Cerrado o vencido: no se edita; sí se puede cerrar si está vencido */
  function periodLocked() {
    return periodIsClosed() || periodIsExpired();
  }

  function lockMessage() {
    if (periodIsClosed()) return 'Ciclo cerrado: no se puede modificar.';
    if (periodIsExpired()) {
      return 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar (o extendé la fecha de fin en Mi cuenta cambiando el día de inicio).';
    }
    return '';
  }

  function currentFxRate() {
    if (!state.budget || !state.budget.period) return 0;
    return Number(state.budget.period.exchangeRate) || 0;
  }

  function formatCycleLabel(c) {
    if (!c) return '';
    var base = c.startDate.split('-').reverse().join('/') + ' → ' + c.endDate.split('-').reverse().join('/');
    if (c.status === 'closed') return base + ' (cerrado)';
    return base;
  }

  /** Acepta 1500.50, 1500,50, 1.500,50 o 1,500.50 */
  function parseMoneyInput(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return NaN;
    s = s.replace(/\s/g, '');
    var hasComma = s.indexOf(',') >= 0;
    var hasDot = s.indexOf('.') >= 0;
    if (hasComma && hasDot) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (hasComma) {
      s = s.replace(',', '.');
    }
    var n = Number(s);
    return isNaN(n) ? NaN : n;
  }

  function parseApiResponse(res, text) {
    var trimmed = String(text || '').trim();
    var json = null;
    try {
      json = trimmed ? JSON.parse(trimmed) : null;
    } catch (e) {
      var looksHtml = trimmed.charAt(0) === '<' || /<!DOCTYPE|Sorry, you have been blocked/i.test(trimmed);
      var errHtml = new Error(
        looksHtml
          ? 'Cloudflare devolvió una página HTML (bloqueo/error de red) en vez del API. Esperá unos segundos y reintentá; si sigue, usá el dominio app (no workers.dev).'
          : 'Respuesta no-JSON del servidor (HTTP ' + res.status + '). Probá de nuevo.'
      );
      errHtml.status = res.status;
      errHtml.retryable = true;
      throw errHtml;
    }
    if (!res.ok) {
      var err = new Error((json && (json.error || json.message)) || ('HTTP ' + res.status));
      err.status = res.status;
      err.json = json;
      throw err;
    }
    return json;
  }

  function api(action, body, _attempt) {
    var attempt = _attempt || 0;
    var payload = Object.assign({ action: action }, body || {});
    var headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Cache-Control': 'no-store'
    };
    var token = getToken();
    if (token) headers['X-Session-Token'] = token;
    return fetch(API, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      cache: 'no-store'
    }).then(function (res) {
      return res.text().then(function (text) {
        return parseApiResponse(res, text);
      });
    }).catch(function (err) {
      // Un reintento corto: a veces workers.dev / edge devuelve HTML de anti-abuse.
      if (err && err.retryable && attempt < 1) {
        return new Promise(function (resolve) {
          setTimeout(resolve, 450);
        }).then(function () {
          return api(action, body, attempt + 1);
        });
      }
      throw err;
    });
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
    state.budget = null;
    if (loginView) loginView.style.display = 'flex';
    if (shell) shell.classList.remove('active');
  }

  function isAdminUser() {
    return !!(state.user && state.user.role === 'admin');
  }

  function userHasModule(name) {
    if (!state.user || isAdminUser()) return false;
    var m = state.user.modules || {};
    return !!m[name];
  }

  function applyShellMode() {
    var admin = isAdminUser();
    var hasConta = userHasModule('contabilidad');
    if (shell) shell.classList.toggle('is-admin-only', admin);
    // Slots AdSense: visibles solo para usuarios (no admin)
    document.querySelectorAll('.ad-slot').forEach(function (slot) {
      slot.hidden = admin;
    });
    var fxBar = document.getElementById('fxBar');
    if (fxBar) fxBar.hidden = admin || !hasConta;
    var cycleSelect = document.getElementById('cycleSelect');
    if (cycleSelect && cycleSelect.closest('.top-field')) {
      cycleSelect.closest('.top-field').hidden = admin || !hasConta;
    }
    var navUsers = document.getElementById('navUsuarios');
    if (navUsers) navUsers.hidden = !admin;
    document.querySelectorAll('.admin-nav [data-panel]').forEach(function (btn) {
      var panel = btn.getAttribute('data-panel');
      if (panel === 'usuarios') {
        btn.hidden = !admin;
        return;
      }
      if (panel === 'cuenta') {
        btn.hidden = false;
        return;
      }
      btn.hidden = admin || !hasConta;
    });
    var billingWrap = document.getElementById('billingFieldWrap');
    if (billingWrap) billingWrap.hidden = admin || !hasConta;
    var phoneEl = document.getElementById('myPhone');
    if (phoneEl && state.user) phoneEl.value = state.user.phone || '';
    var dayInput = document.getElementById('myBillingDay');
    if (dayInput && state.user) dayInput.value = state.user.billingDayStart || 1;
  }

  function showShell(opts) {
    opts = opts || {};
    if (!state.user) loadSessionUser();
    if (loginView) loginView.style.display = 'none';
    if (shell) shell.classList.add('active');
    state.summaryCurrency = 'CRC';
    state.viewCurrency = 'OFFICIAL';
    sessionStorage.setItem(SUMMARY_CUR_KEY, 'CRC');
    sessionStorage.setItem(VIEW_CUR_KEY, 'OFFICIAL');
    syncCurrencyToggles();
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
    if (isAdminUser()) {
      switchPanel('usuarios');
      loadUsers();
      return;
    }
    if (!userHasModule('contabilidad')) {
      switchPanel('cuenta');
      showApiError('No tenés Contabilidad activa. Pedile al admin o usá Bitácora si la tenés.');
      return;
    }
    api('track.module', { module: 'contabilidad' }).catch(function () {});
    loadBudget();
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

  function currentCycleKey() {
    var sel = document.getElementById('cycleSelect');
    if (sel && sel.value) return sel.value;
    if (state.budget && state.budget.cycle) return state.budget.cycle.key;
    return null;
  }

  function loadBudget(cycleKey) {
    return api('budget.get', { cycleKey: cycleKey || currentCycleKey() })
      .then(function (res) {
        state.budget = res;
        renderAll();
      })
      .catch(function (err) {
        showApiError(err.message || 'Error al cargar presupuesto');
      });
  }

  function catName(id) {
    if (!id || !state.budget) return '—';
    var c = (state.budget.categories || []).find(function (x) { return x.id === id; });
    return c ? c.name : '—';
  }

  function catById(id) {
    if (!id || !state.budget) return null;
    return (state.budget.categories || []).find(function (x) { return x.id === id; }) || null;
  }

  function paymentTypeById(id) {
    if (!id || !state.budget) return null;
    return (state.budget.paymentTypes || []).find(function (x) { return x.id === id; }) || null;
  }

  function paymentTypeName(exOrId) {
    if (exOrId && typeof exOrId === 'object') {
      var fromCat = paymentTypeById(exOrId.paymentTypeId);
      if (fromCat) return fromCat.name;
      return exOrId.paymentTypeName || '—';
    }
    var pt = paymentTypeById(exOrId);
    return pt ? pt.name : '—';
  }

  function paymentTypeOptionsHtml(selectedId) {
    var list = (state.budget && state.budget.paymentTypes) || [];
    var opts = '<option value="">— Sin tipo —</option>';
    list.forEach(function (pt) {
      var sel = selectedId && pt.id === selectedId ? ' selected' : '';
      opts += '<option value="' + escapeHtml(pt.id) + '"' + sel + '>' + escapeHtml(pt.name) + '</option>';
    });
    return opts;
  }


  /* Yurguen: colores bien separados (egresos por categoría) */
  var PIE_COLORS = [
    '#c92a2a', '#1c7ed6', '#2f9e44', '#e8590c', '#9c36b5',
    '#0c8599', '#e67700', '#5c7cfa', '#c2255c', '#087f5b',
    '#7048e8', '#f08c00'
  ];

  var VBAR_MAX_PX = 160;

  function renderVerticalBars(el, rows, kind) {
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = '<p class="empty-state" style="margin:0">Sin datos aún.</p>';
      return;
    }
    // Altura en px (height % falla dentro de flex en varios navegadores)
    var max = Math.max.apply(null, rows.map(function (r) { return Number(r.value) || 0; }).concat([0]));
    if (!(max > 0)) max = 1;
    var kindCls = kind === 'income' ? ' vbar-fill--income' : ' vbar-fill--expense';
    el.innerHTML = rows.map(function (r) {
      var v = Number(r.value) || 0;
      var px = Math.max(v > 0 ? 4 : 0, Math.round((v / max) * VBAR_MAX_PX));
      var seriesCls = r.series === 'planned' ? ' vbar-fill--planned' : '';
      return '<div class="vbar-col">' +
        '<span class="vbar-value">' + formatChartMoney(v) + '</span>' +
        '<div class="vbar-track" style="height:' + VBAR_MAX_PX + 'px">' +
        '<div class="vbar-fill' + kindCls + seriesCls + '" style="height:' + px + 'px"></div></div>' +
        '<span class="vbar-label">' + escapeHtml(r.shortLabel || r.label) + '</span></div>';
    }).join('');
  }

  /** Normaliza filas del pastel (tolera server viejo donde value era el bucket). */
  function normalizePieRows(raw) {
    return (raw || []).map(function (r) {
      var planned = Number(r.planned);
      var actual = Number(r.actual != null ? r.actual : r.value);
      if (r.value && typeof r.value === 'object') {
        planned = Number(r.value.planned) || 0;
        actual = Number(r.value.actual) || 0;
      }
      if (isNaN(planned)) planned = 0;
      if (isNaN(actual)) actual = 0;
      return {
        id: r.id,
        label: r.label || 'Otra',
        planned: planned,
        actual: actual,
        value: actual
      };
    }).filter(function (r) {
      return r.actual > 0 || r.planned > 0;
    });
  }

  /** Fallback: armar pastel desde plan + ejecución del periodo en el cliente. */
  function buildPieRowsFromPeriod(b) {
    var period = b && b.period;
    if (!period) return [];
    var rate = currentFxRate();
    var buckets = {};
    function ensure(id, label) {
      if (!buckets[id]) buckets[id] = { id: id, label: label, planned: 0, actual: 0, value: 0 };
      return buckets[id];
    }
    (period.budget || []).forEach(function (line) {
      var cat = catById(line.categoryId);
      if (!cat || cat.type === 'income') return;
      var id = line.categoryId || 'none';
      var row = ensure(id, cat.name || 'Otra');
      row.planned += toCrcLocal(line.planned, line.currency, rate);
    });
    (period.executions || []).forEach(function (ex) {
      var cat = catById(ex.categoryId);
      var type = (cat && cat.type) || ex.type || 'expense';
      if (type === 'income') return;
      var id = ex.categoryId || 'none';
      var label = cat ? cat.name : (id === 'none' ? 'Sin categoría' : 'Otra');
      var row = ensure(id, label);
      row.actual += toCrcLocal(ex.amount, ex.currency, rate);
    });
    return Object.keys(buckets).map(function (k) {
      var row = buckets[k];
      row.value = row.actual;
      return row;
    }).filter(function (r) {
      return r.actual > 0 || r.planned > 0;
    }).sort(function (a, b) {
      return b.actual - a.actual || b.planned - a.planned;
    });
  }

  function renderPieChart(el, rows) {
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = '<p class="empty-state" style="margin:0">Sin gastos por categoría aún.</p>';
      return;
    }
    // Pastel = participación del ejecutado en el total de egresos
    var totalActual = rows.reduce(function (s, r) {
      return s + (Number(r.actual) || 0);
    }, 0);
    var sliceRows = rows.filter(function (r) {
      return (Number(r.actual) || 0) > 0;
    });
    if (!(totalActual > 0) || !sliceRows.length) {
      el.innerHTML = '<p class="empty-state" style="margin:0">Sin egresos ejecutados por categoría aún.</p>';
      return;
    }
    var acc = 0;
    var stops = [];
    var labelHtml = '';
    sliceRows.forEach(function (r, i) {
      var v = Number(r.actual) || 0;
      var start = acc;
      var sweep = (v / totalActual) * 360;
      acc += sweep;
      var color = PIE_COLORS[i % PIE_COLORS.length];
      stops.push(color + ' ' + start.toFixed(2) + 'deg ' + acc.toFixed(2) + 'deg');
      var pctTotal = Math.round((v / totalActual) * 100);
      // Etiqueta % del total sobre el pastel (solo si el trozo es legible)
      if (pctTotal >= 4) {
        var mid = start + sweep / 2;
        var rad = (mid - 90) * Math.PI / 180;
        var dist = 34;
        var left = 50 + Math.cos(rad) * dist;
        var top = 50 + Math.sin(rad) * dist;
        labelHtml +=
          '<span class="pie-slice-pct" style="left:' + left.toFixed(1) + '%;top:' + top.toFixed(1) + '%">' +
          pctTotal + '%</span>';
      }
    });
    var colorById = {};
    sliceRows.forEach(function (r, i) {
      colorById[r.id || r.label] = PIE_COLORS[i % PIE_COLORS.length];
    });
    // Leyenda limpia: montos + solo % del presupuesto de esa categoría
    var legend = rows.map(function (r) {
      var actual = Number(r.actual) || 0;
      var planned = Number(r.planned) || 0;
      var pctSelf = planned > 0 ? Math.round((actual / planned) * 100) : null;
      var color = colorById[r.id || r.label] || '#adb5bd';
      var selfBadge = pctSelf == null
        ? ''
        : ' <span class="pie-legend__self" title="% de su presupuesto">' + pctSelf + '%</span>';
      return '<li class="pie-legend__item">' +
        '<span class="pie-swatch" style="background:' + color + '"></span>' +
        '<div class="pie-legend__body">' +
          '<div class="pie-legend__title">' + escapeHtml(r.label) + selfBadge + '</div>' +
          '<div class="pie-legend__meta">' +
            formatChartMoney(actual) +
            (planned > 0 ? ' / ' + formatChartMoney(planned) : '') +
          '</div>' +
        '</div></li>';
    }).join('');
    el.innerHTML =
      '<div class="pie-disc-wrap">' +
        '<div class="pie-disc" style="background:conic-gradient(' + stops.join(', ') + ')" role="img" aria-label="Gastos por categoría"></div>' +
        labelHtml +
      '</div>' +
      '<ul class="pie-legend">' + legend + '</ul>';
  }

  function setBalanceCard(elId, valueCrc, labelId, positiveLabel, negativeLabel, useViewMoney) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.textContent = useViewMoney ? formatViewMoney(valueCrc) : formatChartMoney(valueCrc);
    var card = el.closest('.stat-card');
    if (!card) return;
    card.classList.remove('stat-card--negative', 'stat-card--positive');
    if (valueCrc < 0) card.classList.add('stat-card--negative');
    else if (valueCrc > 0) card.classList.add('stat-card--positive');
    var lbl = labelId ? document.getElementById(labelId) : null;
    if (lbl && positiveLabel && negativeLabel) {
      lbl.textContent = valueCrc < 0 ? negativeLabel : positiveLabel;
    }
  }

  /** Totales arriba en Presupuesto / Ejecución (misma moneda que gráficos) */
  function renderPanelTotals() {
    var b = state.budget;
    if (!b) return;
    var s = b.summary || {};
    var planInc = Number(s.plannedIncome) || 0;
    var planExp = Number(s.plannedExpense) || 0;
    var planBal = Number(s.plannedBalance) || 0;
    var actInc = Number(s.actualIncome) || 0;
    var actExp = Number(s.actualExpense) || 0;
    var actBal = Number(s.actualBalance) || 0;

    var elPlanIn = document.getElementById('planStatIncome');
    var elPlanEx = document.getElementById('planStatExpense');
    if (elPlanIn) elPlanIn.textContent = formatViewMoney(planInc);
    if (elPlanEx) elPlanEx.textContent = formatViewMoney(planExp);
    setBalanceCard('planStatBalance', planBal, 'planStatBalanceLbl', 'Margen', 'Sobregiro', true);

    var elExeIn = document.getElementById('exeStatIncome');
    var elExeEx = document.getElementById('exeStatExpense');
    if (elExeIn) elExeIn.textContent = formatViewMoney(actInc);
    if (elExeEx) elExeEx.textContent = formatViewMoney(actExp);
    setBalanceCard('exeStatBalance', actBal, null, null, null, true);

    syncCurrencyToggles();
  }

  function renderResumenCharts() {
    var b = state.budget;
    if (!b) return;
    var s = b.summary || {};
    var unit = chartUnitLabel();
    var elPlanIn = document.getElementById('statPlanIncome');
    var elPlanEx = document.getElementById('statPlanExpense');
    var elActIn = document.getElementById('statActIncome');
    var elActEx = document.getElementById('statActExpense');
    if (elPlanIn) elPlanIn.textContent = formatChartMoney(s.plannedIncome);
    if (elPlanEx) elPlanEx.textContent = formatChartMoney(s.plannedExpense);
    if (elActIn) elActIn.textContent = formatChartMoney(s.actualIncome);
    if (elActEx) elActEx.textContent = formatChartMoney(s.actualExpense);
    setBalanceCard('statActBal', s.actualBalance || 0);

    var subIn = document.getElementById('chartIncomeSub');
    var subEx = document.getElementById('chartExpenseSub');
    var subPie = document.getElementById('chartPieSub');
    if (subIn) subIn.textContent = 'Presupuestado vs ejecutado (' + unit + ')';
    if (subEx) subEx.textContent = 'Presupuestado vs ejecutado (' + unit + ')';
    if (subPie) {
      subPie.textContent =
        'En el pastel: % del total · En la lista: ejecutado / presupuestado y % del plan (' + unit + ')';
    }

    renderVerticalBars(document.getElementById('chartIncome'), [
      { value: s.plannedIncome || 0, series: 'planned', shortLabel: 'Presupuestado' },
      { value: s.actualIncome || 0, series: 'actual', shortLabel: 'Ejecutado' }
    ], 'income');
    renderVerticalBars(document.getElementById('chartExpense'), [
      { value: s.plannedExpense || 0, series: 'planned', shortLabel: 'Presupuestado' },
      { value: s.actualExpense || 0, series: 'actual', shortLabel: 'Ejecutado' }
    ], 'expense');
    var pieRows = normalizePieRows((b.charts && b.charts.byCategory) || []);
    if (!pieRows.length) pieRows = buildPieRowsFromPeriod(b);
    renderPieChart(document.getElementById('chartByCategory'), pieRows);

    syncCurrencyToggles();
  }

  function updateCycleChrome() {
    var closed = periodIsClosed();
    var expired = periodIsExpired();
    var locked = closed || expired;
    var bannerClosed = document.getElementById('cycleClosedBanner');
    var bannerExpired = document.getElementById('cycleExpiredBanner');
    if (bannerClosed) bannerClosed.hidden = !closed;
    if (bannerExpired) bannerExpired.hidden = !expired;

    var fxBar = document.getElementById('fxBar');
    var fxInput = document.getElementById('fxRateInput');
    var fxHint = document.getElementById('fxHint');
    var btnFx = document.getElementById('btnSaveFx');
    var btnClose = document.getElementById('btnCloseCycle');
    var rate = currentFxRate();

    if (fxInput) fxInput.value = rate > 0 ? rate : '';
    if (fxBar) fxBar.classList.toggle('is-locked', locked);
    if (btnFx) btnFx.disabled = locked;
    if (fxInput) fxInput.disabled = locked;
    // Cerrar ciclo: desde el último día (endDate <= hoy)
    if (btnClose) {
      var canClose = canCloseCurrentCycle();
      btnClose.hidden = !canClose;
      btnClose.disabled = !canClose;
    }
    if (fxHint) {
      fxHint.textContent = rate > 0
        ? ('1 $ = ₡' + rate.toLocaleString('es-CR'))
        : '1 $ = ₡—';
    }

    var btnNewExe = document.getElementById('btnNewExe');
    if (btnNewExe) btnNewExe.disabled = locked;
  }

  function renderAll() {
    var b = state.budget;
    if (!b) return;

    var sel = document.getElementById('cycleSelect');
    if (sel) {
      sel.innerHTML = (b.cycles || []).map(function (c) {
        var selected = b.cycle && c.key === b.cycle.key ? ' selected' : '';
        return '<option value="' + c.key + '"' + selected + '>' + formatCycleLabel(c) + '</option>';
      }).join('');
    }

    var range = document.getElementById('cycleRangeLabel');
    if (range && b.cycle) {
      var st = periodIsClosed() ? 'cerrado' : (periodIsExpired() ? 'vencido' : 'abierto');
      var dates = (b.cycle.startDate || '').split('-').reverse().join('/') +
        ' → ' + (b.cycle.endDate || '').split('-').reverse().join('/');
      range.textContent = 'Periodo: ' + dates + ' · ' + st;
    }

    updateCycleChrome();
    renderResumenCharts();
    renderPanelTotals();

    renderLoans();
    renderPlan();
    renderPaymentTypes();
    renderExecution();
    renderHistory();
  }

  function renderPaymentTypes() {
    var tbody = document.getElementById('payTypeBody');
    if (!tbody || !state.budget) return;
    var rows = (state.budget.paymentTypes || []).slice().sort(function (a, b) {
      var ao = Number(a.sortOrder);
      var bo = Number(b.sortOrder);
      if (ao !== bo) return (isNaN(ao) ? 9999 : ao) - (isNaN(bo) ? 9999 : bo);
      return String(a.name || '').localeCompare(String(b.name || ''), 'es');
    });
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="empty-state">Sin tipos de pago. Creá efectivo, SINPE, tarjeta, etc.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (pt) {
      return '<tr>' +
        '<td data-label="Nombre"><strong>' + escapeHtml(pt.name) + '</strong></td>' +
        '<td data-label="">' +
        '<button type="button" class="btn btn-outline btn-sm" data-edit-pay="' + escapeHtml(pt.id) + '">Editar</button>' +
        '</td></tr>';
    }).join('');
    tbody.querySelectorAll('[data-edit-pay]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pt = paymentTypeById(btn.getAttribute('data-edit-pay'));
        if (pt) openPayTypeModal(pt);
      });
    });
  }


  function loanFxRate() {
    return Number(state.budget && state.budget.loanFxRate) || currentFxRate() || 0;
  }

  function loanBalanceCrc(loan) {
    var rate = loanFxRate();
    var total = 0;
    (loan.movements || []).forEach(function (m) {
      var sign = Number(m.sign) === -1 ? -1 : 1;
      total += sign * toCrcLocal(m.amount, m.currency, rate);
    });
    return total;
  }

  function loanSideLabel(side) {
    return side === 'borrowed' ? 'Me prestaron' : 'Yo presté';
  }

  function renderLoans() {
    var root = document.getElementById('loansList');
    if (!root || !state.budget) return;
    var loans = (state.budget.loans || []).slice().sort(function (a, b) {
      return (a.person || '').localeCompare(b.person || '', 'es', { sensitivity: 'base' });
    });
    if (!loans.length) {
      root.innerHTML = '<p class="empty-state">Sin préstamos. Agregá una persona para llevar el histórico.</p>';
      return;
    }
    root.innerHTML = loans.map(function (loan) {
      var bal = loanBalanceCrc(loan);
      var sideClass = loan.side === 'borrowed' ? 'loan-side-badge--borrowed' : 'loan-side-badge--lent';
      var balClass = bal === 0 ? ' is-zero' : '';
      var balHint = loan.side === 'borrowed'
        ? (bal > 0 ? 'Debés' : bal < 0 ? 'A tu favor' : 'Saldado')
        : (bal > 0 ? 'Te deben' : bal < 0 ? 'A favor de ellos' : 'Saldado');
      var movs = (loan.movements || []).slice().sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || ''));
      });
      var movRows = movs.length
        ? movs.map(function (m) {
            var signCls = Number(m.sign) === -1 ? 'loan-sign--minus' : 'loan-sign--plus';
            var signTxt = Number(m.sign) === -1 ? '−' : '+';
      return '<tr>' +
              '<td>' + escapeHtml(m.date || '') + '</td>' +
              '<td class="' + signCls + '">' + signTxt + '</td>' +
              '<td>' + formatAmountWithBadge(m.amount, m.currency, Number(m.sign) === -1 ? 'expense' : 'income') + '</td>' +
              '<td>' + escapeHtml(m.note || '—') + '</td>' +
              '<td><button type="button" class="btn btn-outline btn-sm" data-edit-loan-mov="' + loan.id + '" data-mov-id="' + m.id + '">Editar</button></td>' +
              '</tr>';
          }).join('')
        : '<tr><td colspan="5" class="empty-state">Sin movimientos aún.</td></tr>';
      return '<article class="loan-card" data-loan-id="' + loan.id + '">' +
        '<div class="loan-card__head">' +
        '<div><h3>' + escapeHtml(loan.person) +
        '<span class="loan-side-badge ' + sideClass + '">' + loanSideLabel(loan.side) + '</span></h3>' +
        (loan.notes ? '<p class="loan-card__meta">' + escapeHtml(loan.notes) + '</p>' : '') +
        '</div>' +
        '<div class="loan-card__actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-loan-mov="' + loan.id + '">+/− Monto</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-edit-loan="' + loan.id + '">Editar</button>' +
        '</div></div>' +
        '<p class="loan-balance' + balClass + '">' + formatMoney(bal) +
        ' <small style="font-weight:500;color:#7a8889">· ' + balHint + '</small></p>' +
        '<div class="admin-table-wrap"><table class="loan-mov-table">' +
        '<thead><tr><th>Fecha</th><th></th><th>Monto</th><th>Nota</th><th></th></tr></thead>' +
        '<tbody>' + movRows + '</tbody></table></div></article>';
    }).join('');

    root.querySelectorAll('[data-edit-loan]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var loan = (state.budget.loans || []).find(function (x) {
          return x.id === btn.getAttribute('data-edit-loan');
        });
        if (loan) openLoanModal(loan);
      });
    });
    root.querySelectorAll('[data-loan-mov]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openLoanMovModal(btn.getAttribute('data-loan-mov'), null);
      });
    });
    root.querySelectorAll('[data-edit-loan-mov]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openLoanMovModal(btn.getAttribute('data-edit-loan-mov'), btn.getAttribute('data-mov-id'));
      });
    });
  }

  function moveCategory(catId, direction) {
    api('budget.category.move', { id: catId, direction: direction })
      .then(function (res) {
        if (res.categories && state.budget) state.budget.categories = res.categories;
        return loadBudget();
      })
      .catch(function (err) { alert(err.message); });
  }

  function renderPlan() {
    var root = document.getElementById('planBody');
    if (!root || !state.budget) return;
    var locked = periodLocked();
    var cats = sortedCategories();
    if (!cats.length) {
      root.innerHTML = '<p class="empty-state">Sin categorías. Creá una y después agregale uno o más presupuestos.</p>';
      return;
    }
    root.innerHTML = cats.map(function (c, idx) {
      var desc = (c.description || '').trim();
      var lines = planLinesForCategory(c.id);
      var plannedTotal = 0;
      lines.forEach(function (line) {
        plannedTotal += toCrcLocal(line.planned, line.currency, currentFxRate());
      });
      var collapsed = isCatCollapsed(c.id);
      var linesHtml = lines.length
        ? '<table class="cat-plan-lines"><thead><tr><th>Etiqueta</th><th>Monto</th><th></th></tr></thead><tbody>' +
          lines.map(function (line, lineIdx) {
            var lbl = String(line.tag || line.label || line.planLabel || '').trim();
            var actions = locked
              ? '<span style="color:#7a8889;font-size:0.85rem">—</span>'
              : '<span class="cat-plan-line-actions">' +
                '<button type="button" class="btn btn-outline btn-sm" data-move-plan="' + line.id +
                '" data-dir="up" title="Subir"' + (lineIdx > 0 ? '' : ' disabled') + '>↑</button>' +
                '<button type="button" class="btn btn-outline btn-sm" data-move-plan="' + line.id +
                '" data-dir="down" title="Bajar"' + (lineIdx < lines.length - 1 ? '' : ' disabled') + '>↓</button>' +
                '<button type="button" class="btn btn-outline btn-sm" data-edit-plan="' + line.id + '">Editar</button>' +
                '</span>';
            return '<tr>' +
              '<td>' + (lbl ? '<strong>' + escapeHtml(lbl) + '</strong>' : '<span style="color:#7a8889">—</span>') + '</td>' +
              '<td>' + formatPlanLineDisplay(line.planned, line.currency, c.type) + '</td>' +
              '<td>' + actions + '</td></tr>';
          }).join('') +
          '</tbody></table>'
        : '<p class="cat-plan-card__meta">Sin líneas de presupuesto aún.</p>';
      var addPlan = locked
        ? ''
        : '<button type="button" class="btn btn-primary btn-sm" data-add-plan="' + c.id + '">+ Presupuesto</button>';
      var canUp = idx > 0;
      var canDown = idx < cats.length - 1;
      return '<article class="cat-plan-card' + (collapsed ? ' is-collapsed' : '') + '" data-cat-id="' + c.id + '">' +
        '<div class="cat-plan-card__head">' +
        '<div class="cat-plan-card__title">' +
        '<button type="button" class="cat-plan-toggle" data-toggle-cat="' + c.id + '" aria-expanded="' +
        (collapsed ? 'false' : 'true') + '" title="' + (collapsed ? 'Expandir' : 'Reducir') + '">' +
        (collapsed ? '▸' : '▾') + '</button>' +
        '<div><h3>' + escapeHtml(c.name) + ' ' + typeBadge(c.type) + '</h3>' +
        (desc && !collapsed ? '<p class="cat-plan-card__meta">' + escapeHtml(desc) + '</p>' : '') +
        '<p class="cat-plan-card__stats cat-plan-card__stats--inline">' +
        '<strong>Planeado:</strong> ' + formatViewMoney(plannedTotal) +
        (lines.length ? ' · ' + lines.length + (lines.length === 1 ? ' línea' : ' líneas') : '') +
        '</p></div></div>' +
        '<div class="loan-card__actions cat-plan-card__actions">' +
        '<button type="button" class="btn btn-outline btn-sm" data-move-cat="' + c.id +
        '" data-dir="up" title="Subir"' + (canUp ? '' : ' disabled') + '>↑</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-move-cat="' + c.id +
        '" data-dir="down" title="Bajar"' + (canDown ? '' : ' disabled') + '>↓</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-edit-cat="' + c.id + '">Editar</button>' +
        addPlan +
        '</div></div>' +
        '<div class="cat-plan-card__body">' + linesHtml + '</div></article>';
    }).join('');

    root.querySelectorAll('[data-toggle-cat]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-toggle-cat');
        setCatCollapsed(id, !isCatCollapsed(id));
        renderPlan();
      });
    });
    root.querySelectorAll('[data-move-cat]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        moveCategory(btn.getAttribute('data-move-cat'), btn.getAttribute('data-dir'));
      });
    });
    root.querySelectorAll('[data-edit-cat]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var c = state.budget.categories.find(function (x) {
          return x.id === btn.getAttribute('data-edit-cat');
        });
        if (c) openCatModal(c);
      });
    });
    root.querySelectorAll('[data-add-plan]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openPlanModal({ categoryId: btn.getAttribute('data-add-plan') });
      });
    });
    root.querySelectorAll('[data-move-plan]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        movePlanLine(btn.getAttribute('data-move-plan'), btn.getAttribute('data-dir'));
      });
    });
    root.querySelectorAll('[data-edit-plan]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-edit-plan');
        var line = ((state.budget.period && state.budget.period.budget) || []).find(function (x) {
          return x.id === id;
        });
        if (line) openPlanModal(line);
      });
    });
  }

  function readExeFiltersFromDom() {
    var desdeEl = document.getElementById('exeFilterDesde');
    var hastaEl = document.getElementById('exeFilterHasta');
    var catEl = document.getElementById('exeFilterCat');
    var planEl = document.getElementById('exeFilterPlan');
    var payEl = document.getElementById('exeFilterPay');
    state.exeFilters.desde = desdeEl ? String(desdeEl.value || '') : '';
    state.exeFilters.hasta = hastaEl ? String(hastaEl.value || '') : '';
    state.exeFilters.categoryId = catEl ? String(catEl.value || '') : '';
    state.exeFilters.planLineId = planEl ? String(planEl.value || '') : '';
    state.exeFilters.paymentTypeId = payEl ? String(payEl.value || '') : '';
  }

  function exeFiltersActive() {
    var f = state.exeFilters || {};
    return !!(f.desde || f.hasta || f.categoryId || f.planLineId || f.paymentTypeId);
  }

  function clearExeFilters() {
    state.exeFilters = {
      desde: '',
      hasta: '',
      categoryId: '',
      planLineId: '',
      paymentTypeId: ''
    };
    fillExeFilters();
    renderExecution();
  }

  function fillExeFilters() {
    if (!state.budget || !state.budget.period) return;
    var f = state.exeFilters || {};
    var desdeEl = document.getElementById('exeFilterDesde');
    var hastaEl = document.getElementById('exeFilterHasta');
    var catEl = document.getElementById('exeFilterCat');
    var planEl = document.getElementById('exeFilterPlan');
    var payEl = document.getElementById('exeFilterPay');

    if (desdeEl) desdeEl.value = f.desde || '';
    if (hastaEl) hastaEl.value = f.hasta || '';

    if (catEl) {
      var cats = (state.budget.categories || []).slice().sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'es');
      });
      var catOpts = '<option value="">Todas</option>' + cats.map(function (c) {
        return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + '</option>';
      }).join('');
      catEl.innerHTML = catOpts;
      if (f.categoryId && Array.prototype.some.call(catEl.options, function (o) { return o.value === f.categoryId; })) {
        catEl.value = f.categoryId;
      } else {
        catEl.value = '';
        f.categoryId = '';
      }
    }

    if (planEl) {
      var lines = f.categoryId
        ? planLinesForCategory(f.categoryId)
        : (((state.budget.period && state.budget.period.budget) || []).slice().sort(function (a, b) {
          var ao = Number(a.sortOrder);
          var bo = Number(b.sortOrder);
          if (isNaN(ao)) ao = 9999;
          if (isNaN(bo)) bo = 9999;
          if (ao !== bo) return ao - bo;
          return String(a.id || '').localeCompare(String(b.id || ''));
        }));
      var planOpts = '<option value="">Todas</option>' + lines.map(function (line) {
        var cat = catById(line.categoryId);
        var label = planLineLabel(line);
        if (!f.categoryId && cat) label = cat.name + ' · ' + label;
        return '<option value="' + escapeHtml(line.id) + '">' + escapeHtml(label) + '</option>';
      }).join('');
      planEl.innerHTML = planOpts;
      if (f.planLineId && Array.prototype.some.call(planEl.options, function (o) { return o.value === f.planLineId; })) {
        planEl.value = f.planLineId;
      } else {
        planEl.value = '';
        f.planLineId = '';
      }
    }

    if (payEl) {
      var pays = (state.budget.paymentTypes || []).slice().sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'es');
      });
      var payOpts = '<option value="">Todos</option>' + pays.map(function (pt) {
        return '<option value="' + escapeHtml(pt.id) + '">' + escapeHtml(pt.name) + '</option>';
      }).join('');
      payEl.innerHTML = payOpts;
      if (f.paymentTypeId && Array.prototype.some.call(payEl.options, function (o) { return o.value === f.paymentTypeId; })) {
        payEl.value = f.paymentTypeId;
      } else {
        payEl.value = '';
        f.paymentTypeId = '';
      }
    }
  }

  function executionMatchesFilters(ex) {
    var f = state.exeFilters || {};
    var date = String(ex.date || '');
    if (f.desde && date && date < f.desde) return false;
    if (f.hasta && date && date > f.hasta) return false;
    if (f.desde && !date) return false;
    if (f.hasta && !date) return false;
    if (f.categoryId && String(ex.categoryId || '') !== f.categoryId) return false;
    if (f.planLineId && String(ex.planLineId || '') !== f.planLineId) return false;
    if (f.paymentTypeId && String(ex.paymentTypeId || '') !== f.paymentTypeId) return false;
    return true;
  }

  function renderExecution() {
    var tbody = document.getElementById('exeBody');
    if (!tbody || !state.budget || !state.budget.period) return;
    fillExeFilters();
    var locked = periodLocked();
    var allRows = state.budget.period.executions || [];
    var rows = allRows.filter(executionMatchesFilters).slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
    var hint = document.getElementById('exeFilterHint');
    if (hint) {
      if (exeFiltersActive()) {
        hint.hidden = false;
        hint.textContent = 'Mostrando ' + rows.length + ' de ' + allRows.length +
          ' movimiento(s). Los totales de arriba siguen siendo del ciclo completo.';
      } else {
        hint.hidden = true;
        hint.textContent = '';
      }
    }
    if (!allRows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Sin movimientos este ciclo.</td></tr>';
      return;
    }
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Sin movimientos con esos filtros.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (ex) {
      var action = locked
        ? '<span style="color:#7a8889;font-size:0.85rem">—</span>'
        : '<button type="button" class="btn btn-outline btn-sm" data-edit-exe="' + ex.id + '">Editar</button>';
      return '<tr class="' + rowTypeClass(ex.type) + '">' +
        '<td data-label="Fecha">' + escapeHtml(ex.date || '') + '</td>' +
        '<td data-label="Categoría"><strong>' + escapeHtml(ex.name || '') + '</strong>' +
        (ex.notes ? '<br><small>' + escapeHtml(ex.notes) + '</small>' : '') + '</td>' +
        '<td data-label="Línea">' + escapeHtml(planLineName(ex)) + '</td>' +
        '<td data-label="Tipo pago">' + escapeHtml(paymentTypeName(ex)) + '</td>' +
        '<td data-label="Tipo">' + typeBadge(ex.type) + '</td>' +
        '<td data-label="Monto">' + formatPlanLineDisplay(ex.amount, ex.currency, ex.type) + '</td>' +
        '<td data-label="">' + action + '</td></tr>';
    }).join('');
    tbody.querySelectorAll('[data-edit-exe]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ex = state.budget.period.executions.find(function (x) {
          return x.id === btn.getAttribute('data-edit-exe');
        });
        if (ex) openExeModal(ex);
      });
    });
  }

  function fillHistCycleFilter() {
    var sel = document.getElementById('histCycleFilter');
    if (!sel || !state.budget) return;
    var prev = sel.value;
    var cycles = state.budget.cycles || [];
    var opts = '<option value="">Todos (últimos 12)</option>' + cycles.map(function (c) {
      return '<option value="' + c.key + '">' + formatCycleLabel(c) + '</option>';
    }).join('');
    sel.innerHTML = opts;
    if (prev && Array.prototype.some.call(sel.options, function (o) { return o.value === prev; })) {
      sel.value = prev;
    }
  }

  function renderHistory() {
    var tbody = document.getElementById('histBody');
    if (!tbody || !state.budget) return;
    fillHistCycleFilter();
    var filterKey = (document.getElementById('histCycleFilter') || {}).value || '';
    var rows = (state.budget.history || []).filter(function (h) {
      if (h.type === 'income') return false;
      if (filterKey && h.cycleKey !== filterKey) return false;
      return true;
    });
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Sin gastos en este filtro.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (h) {
      return '<tr>' +
        '<td data-label="Fecha">' + escapeHtml(h.date || '') + '</td>' +
        '<td data-label="Ciclo">' + escapeHtml((h.startDate || '') + ' → ' + (h.endDate || '')) + '</td>' +
        '<td data-label="Categoría">' + escapeHtml(h.name || catName(h.categoryId)) + '</td>' +
        '<td data-label="Monto">' + formatAmountWithBadge(h.amount, h.currency) + '</td>' +
        '<td data-label="En ₡">' + formatMoney(h.amountCrc != null ? h.amountCrc : h.amount) + '</td></tr>';
    }).join('');
  }

  function openModal(title, html, mode, id, canDelete) {
    state.modalMode = mode;
    state.modalId = id || null;
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    if (modalDelete) {
      modalDelete.hidden = !canDelete;
      modalDelete.textContent = 'Eliminar';
    }
    modalBackdrop.classList.add('open');
  }

  function closeModal() {
    modalBackdrop.classList.remove('open');
    state.modalMode = null;
    state.modalId = null;
    state.modalLoanId = null;
    if (modalDelete) modalDelete.hidden = true;
  }

  function openCatModal(cat) {
    var c = cat || {};
    openModal(
      cat ? 'Editar categoría' : 'Nueva categoría',
      '<div class="field"><label>Nombre *</label><input id="mCatName" value="' + escapeHtml(c.name || '') + '"></div>' +
      '<div class="field"><label>Tipo</label><select id="mCatType">' +
      '<option value="expense"' + (c.type !== 'income' ? ' selected' : '') + '>Egreso</option>' +
      '<option value="income"' + (c.type === 'income' ? ' selected' : '') + '>Ingreso</option></select></div>' +
      '<div class="field"><label>Comentario</label><textarea id="mCatDesc" rows="2" placeholder="Opcional">' +
      escapeHtml(c.description || '') + '</textarea></div>' +
      '<p style="margin:0;font-size:0.8rem;color:#7a8889">Después podés agregarle varios presupuestos a esta categoría.</p>',
      'category',
      c.id || null,
      !!cat
    );
  }

  function openPlanModal(line) {
    if (periodLocked()) {
      alert(lockMessage());
      return;
    }
    var L = line || {};
    var cats = (state.budget && state.budget.categories) || [];
    if (!cats.length) {
      alert('Primero creá una categoría.');
      return;
    }
    var existingTag = String(L.tag || L.label || L.planLabel || '').trim();
    openModal(
      L.id ? 'Editar presupuesto' : 'Nuevo presupuesto',
      '<div class="field"><label for="mPlanCat">Categoría *</label><select id="mPlanCat">' +
      categoryOptionsHtml(L.categoryId || null) + '</select></div>' +
      '<div class="field"><label for="mPlanTag">Etiqueta</label>' +
      '<input id="mPlanTag" name="planTag" type="text" maxlength="120" value="' +
      escapeHtml(existingTag) + '" placeholder="Ej. Quincena 1, Extra, etc." autocomplete="off"></div>' +
      '<div class="field"><label for="mPlanAmount">Monto planeado *</label>' +
      '<input id="mPlanAmount" type="number" step="any" value="' +
      (L.planned != null ? L.planned : '') + '"></div>' +
      '<div class="field"><label>Moneda *</label>' + currencySelectHtml('mPlanCur', L.currency || 'CRC') + '</div>' +
      '<p style="margin:0;font-size:0.8rem;color:#7a8889">Varias líneas por categoría; la etiqueta las distingue.</p>',
      'plan',
      L.id || null,
      !!L.id
    );
    // Focus etiqueta para que no quede en blanco sin darse cuenta
    setTimeout(function () {
      var el = document.getElementById('mPlanTag');
      if (el) el.focus();
    }, 0);
  }

  function openLoanModal(loan) {
    var L = loan || {};
    openModal(
      loan ? 'Editar persona' : 'Nueva persona (préstamo)',
      '<div class="field"><label>Persona *</label><input id="mLoanPerson" value="' + escapeHtml(L.person || '') + '"></div>' +
      '<div class="field"><label>Tipo</label><select id="mLoanSide">' +
      '<option value="lent"' + (L.side !== 'borrowed' ? ' selected' : '') + '>Yo presté (me deben)</option>' +
      '<option value="borrowed"' + (L.side === 'borrowed' ? ' selected' : '') + '>Me prestaron (yo debo)</option></select></div>' +
      '<div class="field"><label>Notas</label><textarea id="mLoanNotes" rows="2">' + escapeHtml(L.notes || '') + '</textarea></div>' +
      '<p style="margin:0;font-size:0.8rem;color:#7a8889">No afecta el presupuesto. Solo histórico de saldos.</p>',
      'loan',
      L.id || null,
      !!loan
    );
  }

  function openLoanMovModal(loanId, movId) {
    var loan = (state.budget.loans || []).find(function (x) { return x.id === loanId; });
    if (!loan) {
      alert('Préstamo no encontrado.');
      return;
    }
    var mov = null;
    if (movId) {
      mov = (loan.movements || []).find(function (m) { return m.id === movId; });
    }
    var m = mov || {};
    var today = new Date().toISOString().slice(0, 10);
    state.modalLoanId = loanId;
    openModal(
      mov ? 'Editar movimiento' : 'Sumar / restar — ' + loan.person,
      '<div class="field"><label>Operación *</label><select id="mLoanSign">' +
      '<option value="1"' + (Number(m.sign) !== -1 ? ' selected' : '') + '>Sumar (+)</option>' +
      '<option value="-1"' + (Number(m.sign) === -1 ? ' selected' : '') + '>Restar (−)</option></select></div>' +
      '<div class="field"><label>Monto *</label><input id="mLoanAmount" type="number" step="any" value="' +
      (m.amount != null ? m.amount : '') + '"></div>' +
      '<div class="field"><label>Moneda *</label>' + currencySelectHtml('mLoanCur', m.currency || 'CRC') + '</div>' +
      '<div class="field"><label>Fecha</label><input id="mLoanDate" type="date" value="' +
      escapeHtml(m.date || today) + '"></div>' +
      '<div class="field"><label>Nota</label><input id="mLoanNote" value="' + escapeHtml(m.note || '') + '"></div>',
      'loan-mov',
      m.id || null,
      !!mov
    );
  }

  function currencySelectHtml(id, value) {
    var cur = normalizeCur(value);
    return '<div class="currency-field">' +
      '<select id="' + id + '" aria-label="Moneda">' +
      '<option value="CRC"' + (cur === 'CRC' ? ' selected' : '') + '>₡ Colones (CRC)</option>' +
      '<option value="USD"' + (cur === 'USD' ? ' selected' : '') + '>$ Dólares (USD)</option>' +
      '</select>' +
      '<p style="margin:6px 0 0;font-size:0.8rem;color:#7a8889">Si elegís USD, se convierte a ₡ con el tipo de cambio del ciclo.</p>' +
      '</div>';
  }

  function updateExeCatStats() {
    var el = document.getElementById('mExeCatStats');
    var sel = document.getElementById('mExeCat');
    if (!el || !sel || !sel.value) {
      if (el) el.textContent = 'Elegí una categoría para ver el presupuesto.';
      return;
    }
    var st = categoryStatsCrc(sel.value);
    el.innerHTML =
      '<strong>Presupuestado:</strong> ' + formatViewMoney(st.planned) +
      ' · <strong>Ejecutado:</strong> ' + formatViewMoney(st.actual) +
      ' · <strong>Restante:</strong> ' + formatViewMoney(st.remaining);
  }

  function openPayTypeModal(pt) {
    var p = pt || {};
    openModal(
      pt ? 'Editar tipo de pago' : 'Nuevo tipo de pago',
      '<div class="field"><label>Nombre *</label><input id="mPayName" type="text" maxlength="80" value="' +
      escapeHtml(p.name || '') + '" placeholder="Ej. Efectivo, SINPE, Tarjeta"></div>',
      'paymentType',
      p.id || null,
      !!pt
    );
    var input = document.getElementById('mPayName');
    if (input) {
      setTimeout(function () { input.focus(); }, 0);
    }
  }

  function openExeModal(ex) {
    if (periodLocked()) {
      alert(lockMessage());
      return;
    }
    var e = ex || {};
    var cats = (state.budget && state.budget.categories) || [];
    if (!cats.length) {
      alert('Primero creá categorías en Presupuesto.');
      return;
    }
    var opts = categoryOptionsHtml(e.categoryId || null);
    var payOpts = paymentTypeOptionsHtml(e.paymentTypeId || null);
    var initialCat = e.categoryId || ((cats[0] && cats[0].id) || '');
    var planOpts = planLineOptionsHtml(initialCat, e.planLineId || null);
    var today = new Date().toISOString().slice(0, 10);
    openModal(
      ex ? 'Editar movimiento' : 'Nuevo movimiento',
      '<div class="field"><label>Categoría *</label><select id="mExeCat">' + opts + '</select></div>' +
      '<p id="mExeCatStats" class="panel-hint" style="margin:0 0 10px"></p>' +
      '<div class="field"><label>Línea de presupuesto</label><select id="mExePlan">' + planOpts + '</select></div>' +
      '<div class="field"><label>Tipo de pago</label><select id="mExePay">' + payOpts + '</select></div>' +
      '<div class="field"><label>Monto *</label><input id="mExeAmount" type="number" step="any" value="' +
      (e.amount != null ? e.amount : '') + '"></div>' +
      '<div class="field"><label>Moneda *</label>' + currencySelectHtml('mExeCur', e.currency || 'CRC') + '</div>' +
      '<div class="field"><label>Fecha</label><input id="mExeDate" type="date" value="' +
      escapeHtml(e.date || today) + '"></div>' +
      '<div class="field"><label>Notas</label><textarea id="mExeNotes" rows="2">' +
      escapeHtml(e.notes || '') + '</textarea></div>' +
      '<p style="margin:0;font-size:0.8rem;color:#7a8889">Línea y tipo de pago son opcionales. Las líneas salen del Presupuesto de esa categoría.</p>',
      'execution',
      e.id || null,
      !!ex
    );
    var catSel = document.getElementById('mExeCat');
    if (catSel) {
      catSel.addEventListener('change', function () {
        updateExeCatStats();
        refreshExePlanLineOptions('');
      });
      updateExeCatStats();
    }
  }

  function saveModal() {
    if (state.modalMode === 'category') {
      var name = document.getElementById('mCatName').value.trim();
      if (!name) { alert('Nombre obligatorio.'); return; }
      api('budget.category.save', {
        id: state.modalId,
        name: name,
        type: document.getElementById('mCatType').value,
        description: (document.getElementById('mCatDesc') || {}).value
          ? document.getElementById('mCatDesc').value.trim()
          : ''
      })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message); });
      return;
    }
    if (state.modalMode === 'paymentType') {
      var payName = document.getElementById('mPayName').value.trim();
      if (!payName) { alert('Nombre obligatorio.'); return; }
      api('budget.paymentType.save', {
        id: state.modalId,
        name: payName
      })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message); });
      return;
    }
    if (state.modalMode === 'plan') {
      var planCatEl = document.getElementById('mPlanCat');
      var planAmtEl = document.getElementById('mPlanAmount');
      var planCurEl = document.getElementById('mPlanCur');
      var planTagEl = document.getElementById('mPlanTag') || document.getElementById('mPlanLabel');
      var planCat = planCatEl ? planCatEl.value : '';
      var planRaw = planAmtEl ? planAmtEl.value.trim() : '';
      var planAmt = parseMoneyInput(planRaw);
      var planTag = planTagEl ? String(planTagEl.value || '').trim() : '';
      if (!planCat || planRaw === '' || isNaN(planAmt)) {
        alert('Categoría y monto obligatorios. Usá punto o coma para decimales.');
        return;
      }
      api('budget.plan.save', {
        id: state.modalId,
        cycleKey: currentCycleKey(),
        categoryId: planCat,
        planned: planAmt,
        currency: planCurEl ? planCurEl.value : 'CRC',
        tag: planTag,
        label: planTag,
        planLabel: planTag
      })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message); });
      return;
    }
    if (state.modalMode === 'loan') {
      var person = document.getElementById('mLoanPerson').value.trim();
      if (!person) { alert('Persona obligatoria.'); return; }
      api('budget.loan.save', {
        id: state.modalId,
        person: person,
        side: document.getElementById('mLoanSide').value,
        notes: document.getElementById('mLoanNotes').value.trim()
      })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message); });
      return;
    }
    if (state.modalMode === 'loan-mov') {
      var amountRaw = document.getElementById('mLoanAmount').value.trim();
      var amount = parseMoneyInput(amountRaw);
      if (amountRaw === '' || isNaN(amount) || amount < 0) {
        alert('Monto obligatorio. Usá punto o coma para decimales.');
        return;
      }
      api('budget.loan.movement.save', {
        id: state.modalId,
        loanId: state.modalLoanId,
        sign: Number(document.getElementById('mLoanSign').value),
        amount: amount,
        currency: document.getElementById('mLoanCur').value,
        date: document.getElementById('mLoanDate').value,
        note: document.getElementById('mLoanNote').value.trim()
      })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message); });
      return;
    }
    if (state.modalMode === 'execution') {
      var exeCat = document.getElementById('mExeCat').value;
      var amountRaw = document.getElementById('mExeAmount').value.trim();
      var amount = parseMoneyInput(amountRaw);
      if (!exeCat || amountRaw === '' || isNaN(amount)) {
        alert('Categoría y monto obligatorios. Usá punto o coma para decimales.');
        return;
      }
      var payEl = document.getElementById('mExePay');
      var planEl = document.getElementById('mExePlan');
      api('budget.execution.save', {
        id: state.modalId,
        cycleKey: currentCycleKey(),
        categoryId: exeCat,
        amount: amount,
        currency: document.getElementById('mExeCur').value,
        date: document.getElementById('mExeDate').value,
        notes: document.getElementById('mExeNotes').value.trim(),
        paymentTypeId: payEl ? payEl.value : '',
        planLineId: planEl ? planEl.value : ''
      })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message); });
      return;
    }
    if (state.modalMode === 'user') saveUserModal();
  }

  function deleteModal() {
    if (state.modalMode === 'category' && state.modalId) {
      if (!confirm(
        '¿Eliminar categoría?\n\n' +
        'Solo se bloquea si en el ciclo actual tiene ejecución.\n' +
        'Los ciclos cerrados no se tocan.'
      )) return;
      api('budget.category.delete', { id: state.modalId })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message || 'No se pudo eliminar'); });
      return;
    }
    if (state.modalMode === 'paymentType' && state.modalId) {
      if (!confirm(
        '¿Eliminar tipo de pago?\n\n' +
        'Solo se bloquea si en el ciclo actual tiene movimientos asociados.\n' +
        'Los ciclos cerrados no se tocan.'
      )) return;
      api('budget.paymentType.delete', { id: state.modalId })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message || 'No se pudo eliminar'); });
      return;
    }
    if (state.modalMode === 'plan' && state.modalId) {
      if (!confirm(
        '¿Eliminar esta etiqueta / línea de presupuesto?\n\n' +
        'Si tiene movimientos asociados en este ciclo, no se podrá borrar.'
      )) return;
      api('budget.plan.delete', { cycleKey: currentCycleKey(), id: state.modalId })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message || 'No se pudo eliminar'); });
      return;
    }
    if (state.modalMode === 'loan' && state.modalId) {
      if (!confirm('¿Eliminar esta persona y todo su histórico de préstamos?')) return;
      api('budget.loan.delete', { id: state.modalId })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message); });
      return;
    }
    if (state.modalMode === 'loan-mov' && state.modalId) {
      if (!confirm('¿Eliminar este movimiento?')) return;
      api('budget.loan.movement.delete', { loanId: state.modalLoanId, id: state.modalId })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message); });
      return;
    }
    if (state.modalMode === 'execution' && state.modalId) {
      if (!confirm('¿Eliminar movimiento?')) return;
      api('budget.execution.delete', { cycleKey: currentCycleKey(), id: state.modalId })
        .then(function () { closeModal(); return loadBudget(); })
        .catch(function (err) { alert(err.message); });
      return;
    }
    if (state.modalMode === 'user') deleteUserModal();
  }

  function saveProfile() {
    var phoneEl = document.getElementById('myPhone');
    var phone = phoneEl ? phoneEl.value.trim() : '';
    var payload = { phone: phone };
    if (userHasModule('contabilidad')) {
      var day = Number(document.getElementById('myBillingDay').value) || 1;
      var prev = (state.user && state.user.billingDayStart) || 1;
      if (day !== prev) {
        var ok = confirm(
          'Vas a cambiar el día de inicio de ' + prev + ' a ' + day + '.\n\n' +
          'Ese día es cuando arranca cada ciclo (ej. 1 = del 1 al fin de mes).\n' +
          'El inicio del periodo actual no cambia; se recalcula el FIN\n' +
          '(día anterior al próximo inicio). No puede quedar antes de hoy.\n' +
          'Los periodos cerrados no se tocan.\n\n' +
          '¿Confirmás el cambio?'
        );
        if (!ok) {
          document.getElementById('myBillingDay').value = prev;
          return;
        }
      }
      payload.billingDayStart = day;
    }
    api('profile.update', payload)
      .then(function (res) {
        setSession(getToken(), res.user);
        var dayInput = document.getElementById('myBillingDay');
        if (dayInput) dayInput.value = res.user.billingDayStart || 1;
        if (phoneEl) phoneEl.value = res.user.phone || '';
        if (res.period && state.budget && state.budget.period && res.period.key === state.budget.period.key) {
          state.budget.period.startDate = res.period.startDate;
          state.budget.period.endDate = res.period.endDate;
          if (state.budget.cycle) {
            state.budget.cycle.startDate = res.period.startDate;
            state.budget.cycle.endDate = res.period.endDate;
          }
        }
        if (userHasModule('contabilidad')) return loadBudget();
      })
      .catch(function (err) { alert(err.message || 'No se pudo guardar'); });
  }

  function saveFxRate() {
    if (periodLocked()) {
      alert(lockMessage());
      return;
    }
    var raw = document.getElementById('fxRateInput').value.trim();
    var rate = parseMoneyInput(raw);
    if (raw === '' || isNaN(rate) || rate < 0) {
      alert('Tipo de cambio inválido. Usá punto o coma para decimales.');
      return;
    }
    api('budget.period.update', {
      cycleKey: currentCycleKey(),
      exchangeRate: rate
    })
      .then(function () { return loadBudget(); })
      .catch(function (err) { alert(err.message || 'No se pudo guardar el TC'); });
  }

  function canCloseCurrentCycle() {
    if (periodIsClosed()) return false;
    if (state.budget && state.budget.canClosePeriod) return true;
    var end = state.budget && state.budget.period && state.budget.period.endDate;
    if (!end) return false;
    var today = new Date();
    var todayIsoStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    return String(end) <= todayIsoStr;
  }

  function closeCurrentCycle() {
    if (periodIsClosed()) return;
    if (!canCloseCurrentCycle()) {
      var end = state.budget && state.budget.period && state.budget.period.endDate;
      var endLabel = end ? String(end).split('-').reverse().join('/') : '';
      alert(
        'No se puede cerrar el ciclo hasta el último día' +
          (endLabel ? ' (' + endLabel + ')' : '') +
          '.'
      );
      return;
    }
    var rate = currentFxRate();
    var p = state.budget && state.budget.period;
    var dates = p
      ? ((p.startDate || '').split('-').reverse().join('/') + ' → ' + (p.endDate || '').split('-').reverse().join('/'))
      : '';
    var ok = confirm(
      '¿Cerrar este periodo?\n\n' +
      'Periodo: ' + dates + '\n' +
      'Tipo de cambio: 1 $ = ₡' + (rate > 0 ? rate.toLocaleString('es-CR') : '—') + '\n\n' +
      'Se congela tal cual está (TC, fechas, presupuesto y ejecución).\n' +
      'Después NO se puede cambiar nunca.\n' +
      'Se abre el siguiente ciclo con las mismas líneas de presupuesto\n' +
      '(la ejecución arranca vacía).\n\n' +
      '¿Confirmás el cierre?'
    );
    if (!ok) return;
    api('budget.period.close', { cycleKey: currentCycleKey() })
      .then(function (res) {
        var nextKey = res.nextCycle && res.nextCycle.key;
        return loadBudget(nextKey || null);
      })
      .catch(function (err) { alert(err.message || 'No se pudo cerrar'); });
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
            (u.modules && u.modules.bitacora) ? 'Bitácora' : null
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
    var mods = u.modules || { contabilidad: true, bitacora: true };
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
        '<label class="check-inline"><input type="checkbox" id="mModFoco"' + (mods.bitacora !== false ? ' checked' : '') + '> Bitácora</label>' +
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
      bitacora: !!(document.getElementById('mModFoco') && document.getElementById('mModFoco').checked)
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

  function changePassword() {
    var cur = document.getElementById('curPass').value;
    var n1 = document.getElementById('newPass').value;
    var n2 = document.getElementById('newPass2').value;
    var msg = document.getElementById('passMsg');
    if (msg) msg.hidden = true;
    if (!cur || !n1) {
      alert('Completá los campos.');
      return;
    }
    if (n1 !== n2) {
      alert('La contraseña nueva no coincide.');
      return;
    }
    if (n1.length < 6) {
      alert('Mínimo 6 caracteres.');
      return;
    }
    api('changePassword', { currentPassword: cur, newPassword: n1 })
      .then(function () {
        document.getElementById('curPass').value = '';
        document.getElementById('newPass').value = '';
        document.getElementById('newPass2').value = '';
        if (msg) {
          msg.hidden = false;
          msg.textContent = 'Contraseña actualizada.';
          msg.className = 'admin-msg ok';
        }
      })
      .catch(function (err) { alert(err.message || 'No se pudo cambiar'); });
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
      switchPanel(btn.getAttribute('data-panel'));
    });
  });

  var btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', function () {
      api('logout').catch(function () { /* ignore */ }).finally(showLogin);
    });
  }

  var cycleSelect = document.getElementById('cycleSelect');
  if (cycleSelect) {
    cycleSelect.addEventListener('change', function () {
      loadBudget(cycleSelect.value);
    });
  }

  var btnNewCat = document.getElementById('btnNewCat');
  if (btnNewCat) btnNewCat.addEventListener('click', function () { openCatModal(null); });
  var btnNewPayType = document.getElementById('btnNewPayType');
  if (btnNewPayType) btnNewPayType.addEventListener('click', function () { openPayTypeModal(null); });
  var btnNewLoan = document.getElementById('btnNewLoan');
  if (btnNewLoan) btnNewLoan.addEventListener('click', function () { openLoanModal(null); });
  var btnNewExe = document.getElementById('btnNewExe');
  if (btnNewExe) btnNewExe.addEventListener('click', function () { openExeModal(null); });
  var btnNewUser = document.getElementById('btnNewUser');
  if (btnNewUser) btnNewUser.addEventListener('click', function () { openUserModal(null); });
  var btnChangePass = document.getElementById('btnChangePass');
  if (btnChangePass) btnChangePass.addEventListener('click', changePassword);
  var btnSaveProfile = document.getElementById('btnSaveProfile');
  if (btnSaveProfile) btnSaveProfile.addEventListener('click', saveProfile);
  var btnSaveFx = document.getElementById('btnSaveFx');
  if (btnSaveFx) btnSaveFx.addEventListener('click', saveFxRate);
  document.querySelectorAll('[data-summary-cur]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cur = btn.getAttribute('data-summary-cur');
      if (cur === 'USD' && !(currentFxRate() > 0)) {
        alert('Definí y guardá el tipo de cambio arriba para ver montos en dólares.');
        return;
      }
      setSummaryCurrency(cur);
    });
  });
  document.querySelectorAll('[data-view-cur]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cur = btn.getAttribute('data-view-cur');
      if (cur === 'USD' && !(currentFxRate() > 0)) {
        alert('Definí y guardá el tipo de cambio arriba para ver montos en dólares.');
        return;
      }
      setViewCurrency(cur);
    });
  });
  var btnCloseCycle = document.getElementById('btnCloseCycle');
  if (btnCloseCycle) btnCloseCycle.addEventListener('click', closeCurrentCycle);
  var histCycleFilter = document.getElementById('histCycleFilter');
  if (histCycleFilter) {
    histCycleFilter.addEventListener('change', function () {
      renderHistory();
    });
  }
  function onExeFilterChange() {
    readExeFiltersFromDom();
    // Si cambia categoría, la línea debe revalidarse contra ese subset
    var catChanged = this && this.id === 'exeFilterCat';
    if (catChanged) {
      state.exeFilters.planLineId = '';
      fillExeFilters();
    }
    renderExecution();
  }
  ['exeFilterDesde', 'exeFilterHasta', 'exeFilterCat', 'exeFilterPlan', 'exeFilterPay'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', onExeFilterChange);
  });
  var btnClearExeFilters = document.getElementById('btnClearExeFilters');
  if (btnClearExeFilters) {
    btnClearExeFilters.addEventListener('click', clearExeFilters);
  }

  if (modalSave) modalSave.addEventListener('click', saveModal);
  if (modalCancel) modalCancel.addEventListener('click', closeModal);
  if (modalDelete) modalDelete.addEventListener('click', deleteModal);
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
        if (location.protocol === 'file:') {
          showLoginError('Abrí http://localhost:8080/contabilidad (no el archivo directo).');
        }
      });
  } else {
    showLogin();
    if (location.protocol === 'file:') {
      showLoginError('Abrí http://localhost:8080/contabilidad (no el archivo directo).');
    }
  }
})();
