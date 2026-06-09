/* Yurguen: panel interno (eh-mnt.*) — cobros vía API; el sitio público no lee cobros.json */
(function () {
  'use strict';

  var AUTH_KEY = 'exha_admin_auth';
  var EMAIL_KEY = 'exha_admin_email';
  var PASS_KEY = 'exha_admin_password';
  var API = 'api/eh-data.php';

  var PERIOD_LABELS = {
    monthly: 'Mensual',
    quarterly: 'Trimestral',
    yearly: 'Anual'
  };

  var state = {
    data: { settings: { defaultExchangeRate: 520 }, clients: [], services: [], payments: [] },
    selectedClientId: null,
    saving: false
  };

  function uid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getSessionEmail() {
    return sessionStorage.getItem(EMAIL_KEY) || '';
  }

  function getSessionPassword() {
    return sessionStorage.getItem(PASS_KEY) || '';
  }

  function isAuthed() {
    return sessionStorage.getItem(AUTH_KEY) === '1'
      && !!getSessionEmail()
      && !!getSessionPassword();
  }

  function setAuthed(ok, email, password) {
    if (ok) {
      sessionStorage.setItem(AUTH_KEY, '1');
      sessionStorage.setItem(EMAIL_KEY, email);
      sessionStorage.setItem(PASS_KEY, password);
    } else {
      sessionStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(EMAIL_KEY);
      sessionStorage.removeItem(PASS_KEY);
    }
  }

  function periodNow() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function defaultRate() {
    return Number(state.data.settings && state.data.settings.defaultExchangeRate) || 520;
  }

  function resolveRate(svc) {
    if (!svc || svc.currency !== 'USD') return null;
    var r = svc.exchangeRate;
    return r != null && r !== '' ? Number(r) : defaultRate();
  }

  function amountToCrc(amount, currency, exchangeRate) {
    var n = Number(amount) || 0;
    if (currency === 'USD') {
      var rate = exchangeRate != null ? Number(exchangeRate) : defaultRate();
      return Math.round(n * rate);
    }
    return Math.round(n);
  }

  function formatMoney(n, cur) {
    var num = Number(n) || 0;
    if (cur === 'USD') return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return '₡' + num.toLocaleString('es-CR');
  }

  function formatAmountDisplay(item) {
    var cur = item.currency || 'CRC';
    var amt = item.amountMonthly != null ? item.amountMonthly : item.amount;
    if (cur === 'USD') {
      var rate = item.exchangeRate != null && item.exchangeRate !== ''
        ? Number(item.exchangeRate)
        : (resolveRate(item) || defaultRate());
      var crc = item.amountCrc != null ? Number(item.amountCrc) : amountToCrc(amt, 'USD', rate);
      return formatMoney(amt, 'USD') + ' <small>(₡' + crc.toLocaleString('es-CR') + ' @ ' + rate + ')</small>';
    }
    return formatMoney(amt, 'CRC');
  }

  function apiFetch(method, body, query) {
    var url = API + (query || '');
    var opts = {
      method: method,
      headers: {
        'X-Admin-Email': getSessionEmail(),
        'X-Admin-Password': getSessionPassword()
      }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error(json.error || 'Error de servidor');
        return json;
      });
    });
  }

  function loadData() {
    return apiFetch('GET').then(function (data) {
      state.data = data;
      normalizeSettings();
      return data;
    });
  }

  // Yurguen: política de retención del historial pagado (bitácora)
  function normalizeSettings() {
    if (!state.data.settings) state.data.settings = {};
    var s = state.data.settings;
    if (s.retentionMonths == null) s.retentionMonths = 24;
    if (s.autoPurge == null) s.autoPurge = true;
  }

  function retentionMonths() {
    var m = Number(state.data.settings.retentionMonths);
    return m > 0 ? m : 0;
  }

  function cutoffPeriod() {
    var months = retentionMonths();
    if (!months) return null;
    var d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - months);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function purgeOldPayments() {
    var cutoff = cutoffPeriod();
    if (!cutoff) return 0;
    var before = state.data.payments.length;
    state.data.payments = state.data.payments.filter(function (p) {
      return p.period >= cutoff;
    });
    return before - state.data.payments.length;
  }

  // Yurguen: cada guardado cifra cobros.json con la clave de la sesión (auth.local.json)
  function saveData() {
    if (state.saving) return Promise.resolve();
    state.saving = true;
    return apiFetch('POST', { action: 'save', data: state.data }).finally(function () {
      state.saving = false;
    });
  }

  function persist() {
    return saveData().then(function () {
      return loadData();
    }).then(function () {
      renderAll();
    });
  }

  function clientById(id) {
    return state.data.clients.find(function (c) { return c.id === id; });
  }

  function serviceById(id) {
    return state.data.services.find(function (s) { return s.id === id; });
  }

  function paymentFromService(svc, period) {
    var rate = resolveRate(svc);
    var cur = svc.currency || 'CRC';
    var amt = Number(svc.amountMonthly) || 0;
    return {
      id: uid(),
      serviceId: svc.id,
      period: period,
      amount: amt,
      currency: cur,
      exchangeRate: cur === 'USD' ? rate : null,
      amountCrc: amountToCrc(amt, cur, rate),
      status: 'pending',
      paidAt: null,
      description: svc.description || '',
      notes: ''
    };
  }

  function ensureMonthPayments() {
    var period = periodNow();
    state.data.services.forEach(function (svc) {
      if (svc.active === false) return;
      if (svc.periodicity && svc.periodicity !== 'monthly') return;
      var exists = state.data.payments.some(function (p) {
        return p.serviceId === svc.id && p.period === period;
      });
      if (!exists) state.data.payments.push(paymentFromService(svc, period));
    });
    return saveData().then(loadData);
  }

  function paymentStatus(p, svc) {
    if (p.status === 'paid') return 'paid';
    var day = svc ? svc.billingDay : 1;
    if (new Date().getDate() > day) return 'overdue';
    return 'pending';
  }

  function paymentCrc(p) {
    if (p.amountCrc != null) return Number(p.amountCrc);
    return amountToCrc(p.amount, p.currency || 'CRC', p.exchangeRate);
  }

  // ---- DOM ----
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
  var modalMode = null;
  var modalEntityId = null;

  function showApiError(msg) {
    if (apiError) {
      apiError.hidden = !msg;
      apiError.textContent = msg || '';
    }
  }

  function showShell() {
    loginView.style.display = 'none';
    shell.classList.add('active');
    showApiError('');
    loadData()
      .then(function () {
        if (state.data.settings.autoPurge !== false) {
          var n = purgeOldPayments();
          if (n > 0) return saveData().then(loadData);
        }
      })
      .then(function () { return ensureMonthPayments(); })
      .then(renderAll)
      .catch(function (err) {
        showApiError('No se pudo conectar al archivo de datos. Corré: npm start (o hosting con PHP).');
        console.error(err);
      });
  }

  function showLogin() {
    setAuthed(false);
    loginView.style.display = 'flex';
    shell.classList.remove('active');
  }

  function switchPanel(name) {
    navButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-panel') === name);
    });
    panels.forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
  }

  function renderExchangeSettings() {
    var inp = document.getElementById('defaultExchangeRate');
    if (inp) inp.value = defaultRate();
  }

  function renderRetentionSettings() {
    var sel = document.getElementById('retentionMonths');
    var auto = document.getElementById('autoPurge');
    var hint = document.getElementById('retentionHint');
    if (sel) sel.value = String(retentionMonths() || 0);
    if (auto) auto.checked = state.data.settings.autoPurge !== false;
    if (hint) {
      var cut = cutoffPeriod();
      if (!retentionMonths()) {
        hint.textContent = 'Sin límite: la bitácora crece hasta que exportés o limpiés manualmente.';
      } else {
        hint.textContent = 'Se borran cobros con período anterior a ' + cut + ' (pagados y pendientes viejos). Recomendado: 24 meses.';
      }
    }
  }

  function renderBitacora() {
    var tbody = document.getElementById('bitacoraBody');
    var countEl = document.getElementById('bitacoraCount');
    if (!tbody) return;
    var rows = state.data.payments
      .filter(function (p) { return p.status === 'paid'; })
      .map(function (p) {
        var svc = serviceById(p.serviceId);
        if (!svc) return null;
        return { p: p, svc: svc, client: clientById(svc.clientId) };
      })
      .filter(Boolean)
      .sort(function (a, b) {
        var da = a.p.paidAt || a.p.period;
        var db = b.p.paidAt || b.p.period;
        return db.localeCompare(da);
      });

    if (countEl) countEl.textContent = rows.length + ' registro(s) en bitácora.';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Aún no hay pagos marcados como pagados.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function (row) {
      var fecha = row.p.paidAt ? formatDateCr(row.p.paidAt) : '—';
      return '<tr>' +
        '<td>' + escapeHtml(fecha) + '</td>' +
        '<td>' + escapeHtml(row.p.period) + '</td>' +
        '<td>' + escapeHtml(row.client ? row.client.name : '—') + '</td>' +
        '<td>' + escapeHtml(row.svc.name) + '</td>' +
        '<td class="desc-cell">' + escapeHtml(paymentDescription(row.p) || '—') + '</td>' +
        '<td>' + formatMoney(paymentCrc(row.p), 'CRC') + '</td></tr>';
    }).join('');
  }

  function formatDateCr(iso) {
    var parts = String(iso).slice(0, 10).split('-');
    if (parts.length !== 3) return iso;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function renderStats() {
    var period = periodNow();
    var monthPayments = state.data.payments.filter(function (p) { return p.period === period; });
    var expected = 0;
    var collected = 0;
    var pending = 0;
    monthPayments.forEach(function (p) {
      var crc = paymentCrc(p);
      expected += crc;
      if (p.status === 'paid') collected += crc;
      else pending += crc;
    });
    var elExpected = document.getElementById('statExpected');
    var elCollected = document.getElementById('statCollected');
    var elPending = document.getElementById('statPending');
    var elClients = document.getElementById('statClients');
    var periodLabel = document.getElementById('periodLabel');
    if (elExpected) elExpected.textContent = formatMoney(expected, 'CRC');
    if (elCollected) elCollected.textContent = formatMoney(collected, 'CRC');
    if (elPending) elPending.textContent = formatMoney(pending, 'CRC');
    if (elClients) elClients.textContent = String(state.data.clients.filter(function (c) { return c.active !== false; }).length);
    if (periodLabel) periodLabel.textContent = period;
    renderExchangeSettings();
    renderRetentionSettings();
  }

  function renderPaymentsTable() {
    var tbody = document.getElementById('paymentsBody');
    if (!tbody) return;
    var period = periodNow();
    var rows = state.data.payments
      .filter(function (p) { return p.period === period; })
      .map(function (p) {
        var svc = serviceById(p.serviceId);
        if (!svc) return null;
        return { p: p, svc: svc, client: clientById(svc.clientId), st: paymentStatus(p, svc) };
      })
      .filter(Boolean);

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No hay cobros este mes.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function (row) {
      var badgeClass = row.st === 'paid' ? 'badge-paid' : (row.st === 'overdue' ? 'badge-overdue' : 'badge-pending');
      var badgeText = row.st === 'paid' ? 'Pagado' : (row.st === 'overdue' ? 'Vencido' : 'Pendiente');
      var per = PERIOD_LABELS[row.svc.periodicity || 'monthly'] || 'Mensual';
      var desc = paymentDescription(row.p);
      var payBtn = row.p.status === 'paid'
        ? '<button type="button" class="btn btn-outline btn-sm" data-unpay="' + row.p.id + '">Pendiente</button>'
        : '<button type="button" class="btn btn-primary btn-sm" data-pay="' + row.p.id + '">Pagado</button>';
      return '<tr>' +
        '<td><strong>' + escapeHtml(row.client ? row.client.name : '—') + '</strong></td>' +
        '<td>' + escapeHtml(row.svc.name) + '</td>' +
        '<td class="desc-cell">' + escapeHtml(desc || '—') +
        ' <button type="button" class="btn btn-outline btn-sm" data-edit-pay="' + row.p.id + '">Editar</button></td>' +
        '<td>' + per + '</td>' +
        '<td>Día ' + row.svc.billingDay + '</td>' +
        '<td>' + formatAmountDisplay(row.p) + '</td>' +
        '<td><span class="badge-status ' + badgeClass + '">' + badgeText + '</span></td>' +
        '<td>' + payBtn + '</td></tr>';
    }).join('');

    tbody.querySelectorAll('[data-pay]').forEach(function (btn) {
      btn.addEventListener('click', function () { markPaid(btn.getAttribute('data-pay'), true); });
    });
    tbody.querySelectorAll('[data-unpay]').forEach(function (btn) {
      btn.addEventListener('click', function () { markPaid(btn.getAttribute('data-unpay'), false); });
    });
    tbody.querySelectorAll('[data-edit-pay]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = state.data.payments.find(function (x) { return x.id === btn.getAttribute('data-edit-pay'); });
        if (p) openPaymentModal(p);
      });
    });
  }

  function paymentDescription(p) {
    return (p.description || p.notes || '').trim();
  }

  function markPaid(id, paid) {
    var p = state.data.payments.find(function (x) { return x.id === id; });
    if (!p) return;
    p.status = paid ? 'paid' : 'pending';
    p.paidAt = paid ? new Date().toISOString().slice(0, 10) : null;
    persist();
  }

  function renderClientList() {
    var list = document.getElementById('clientList');
    if (!list) return;
    var clients = state.data.clients.slice().sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });
    if (!clients.length) {
      list.innerHTML = '<p class="empty-state">Sin clientes.</p>';
      return;
    }
    list.innerHTML = clients.map(function (c) {
      var sel = state.selectedClientId === c.id ? ' selected' : '';
      var n = state.data.services.filter(function (s) { return s.clientId === c.id; }).length;
      return '<div class="client-item' + sel + '" data-client="' + c.id + '">' +
        '<div><strong>' + escapeHtml(c.name) + '</strong>' +
        '<small>' + n + ' servicio' + (n === 1 ? '' : 's') + (c.active === false ? ' · inactivo' : '') + '</small></div><span>→</span></div>';
    }).join('');
    list.querySelectorAll('[data-client]').forEach(function (el) {
      el.addEventListener('click', function () {
        state.selectedClientId = el.getAttribute('data-client');
        renderClientList();
        renderClientDetail();
      });
    });
  }

  function renderClientDetail() {
    var box = document.getElementById('clientDetail');
    if (!box) return;
    if (!state.selectedClientId) {
      box.innerHTML = '<p class="empty-state">Seleccioná un cliente.</p>';
      return;
    }
    var c = clientById(state.selectedClientId);
    if (!c) {
      box.innerHTML = '<p class="empty-state">No encontrado.</p>';
      return;
    }
    var services = state.data.services.filter(function (s) { return s.clientId === c.id; });
    var svcHtml = services.length
      ? '<table class="admin-table"><thead><tr><th>Servicio</th><th>Periodicidad</th><th>Cobro/mes</th><th>Día</th><th></th></tr></thead><tbody>' +
        services.map(function (s) {
          return '<tr><td>' + escapeHtml(s.name) + '</td>' +
            '<td>' + (PERIOD_LABELS[s.periodicity || 'monthly'] || 'Mensual') + '</td>' +
            '<td>' + formatAmountDisplay(s) + '</td>' +
            '<td>' + s.billingDay + '</td>' +
            '<td><button type="button" class="btn btn-outline btn-sm" data-edit-svc="' + s.id + '">Editar</button> ' +
            '<button type="button" class="btn btn-outline btn-sm" data-del-svc="' + s.id + '">Quitar</button></td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="empty-state">Sin servicios.</p>';

    box.innerHTML =
      '<h2>' + escapeHtml(c.name) + '</h2>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">' +
      '<button type="button" class="btn btn-primary btn-sm" id="btnEditClient">Editar</button>' +
      '<button type="button" class="btn btn-outline btn-sm" id="btnAddService">+ Servicio</button>' +
      '<button type="button" class="btn btn-danger btn-sm" id="btnDeleteClient">Eliminar</button></div>' +
      '<h3>Servicios</h3>' + svcHtml;

    document.getElementById('btnEditClient').onclick = function () { openClientModal(c); };
    document.getElementById('btnAddService').onclick = function () { openServiceModal(c.id); };
    document.getElementById('btnDeleteClient').onclick = function () {
      if (!confirm('¿Eliminar cliente y todo lo relacionado?')) return;
      var svcIds = state.data.services.filter(function (s) { return s.clientId === c.id; }).map(function (s) { return s.id; });
      state.data.clients = state.data.clients.filter(function (x) { return x.id !== c.id; });
      state.data.services = state.data.services.filter(function (s) { return s.clientId !== c.id; });
      state.data.payments = state.data.payments.filter(function (p) { return svcIds.indexOf(p.serviceId) === -1; });
      state.selectedClientId = null;
      persist();
    };
    box.querySelectorAll('[data-del-svc]').forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm('¿Quitar servicio?')) return;
        var sid = btn.getAttribute('data-del-svc');
        state.data.services = state.data.services.filter(function (s) { return s.id !== sid; });
        state.data.payments = state.data.payments.filter(function (p) { return p.serviceId !== sid; });
        persist().then(ensureMonthPayments);
      };
    });
    box.querySelectorAll('[data-edit-svc]').forEach(function (btn) {
      btn.onclick = function () {
        var s = serviceById(btn.getAttribute('data-edit-svc'));
        if (s) openServiceModal(s.clientId, s);
      };
    });
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function renderAll() {
    renderStats();
    renderPaymentsTable();
    renderBitacora();
    renderClientList();
    renderClientDetail();
  }

  function openModal(title, html, mode, id) {
    modalMode = mode;
    modalEntityId = id;
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalBackdrop.classList.add('open');
    if (mode === 'service') bindServiceModalFields();
  }

  function closeModal() {
    modalBackdrop.classList.remove('open');
    modalMode = null;
    modalEntityId = null;
  }

  function bindServiceModalFields() {
    var cur = document.getElementById('mCurrency');
    var wrap = document.getElementById('mRateWrap');
    var preview = document.getElementById('mCrcPreview');
    function refresh() {
      var isUsd = cur && cur.value === 'USD';
      if (wrap) wrap.style.display = isUsd ? 'block' : 'none';
      if (preview && isUsd) {
        var amt = Number(document.getElementById('mAmount').value) || 0;
        var rate = Number(document.getElementById('mExchangeRate').value) || defaultRate();
        preview.textContent = 'Equivalente: ' + formatMoney(amountToCrc(amt, 'USD', rate), 'CRC') + ' (tipo ' + rate + ')';
      } else if (preview) preview.textContent = '';
    }
    if (cur) cur.onchange = refresh;
    ['mAmount', 'mExchangeRate'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.oninput = refresh;
    });
    refresh();
  }

  // Yurguen: cliente solo requiere nombre
  function openClientModal(client) {
    var c = client || {};
    openModal(
      client ? 'Editar cliente' : 'Nuevo cliente',
      '<div class="field"><label>Nombre del cliente *</label><input id="mName" value="' + escapeHtml(c.name || '') + '" placeholder="Ej. Ferretería El Buen Precio"></div>' +
      '<div class="field"><label><input type="checkbox" id="mActive" ' + (c.active !== false ? 'checked' : '') + '> Activo</label></div>',
      'client',
      c.id || null
    );
  }

  function openPaymentModal(payment) {
    openModal(
      'Descripción del cobro',
      '<div class="field"><label>Descripción (qué se cobra este mes)</label>' +
      '<textarea id="mPayDesc" rows="4" placeholder="Ej. Mantenimiento web + hosting marzo 2026">' +
      escapeHtml(paymentDescription(payment)) + '</textarea></div>' +
      '<p style="font-size:0.85rem;color:#7a8889">Podés personalizarla por mes; si está vacía al crear el cobro, se usa la del servicio.</p>',
      'payment',
      payment.id
    );
  }

  function openServiceModal(clientId, service) {
    var s = service || {};
    var rateVal = s.exchangeRate != null ? s.exchangeRate : '';
    openModal(
      service ? 'Editar servicio' : 'Servicio de cobro',
      '<div class="field"><label>Nombre del servicio *</label><input id="mSvcName" value="' + escapeHtml(s.name || '') + '" placeholder="Ej. Mantenimiento web"></div>' +
      '<div class="field"><label>Descripción del cobro (por defecto cada mes)</label>' +
      '<textarea id="mSvcDesc" rows="2" placeholder="Ej. Hosting + actualizaciones del sitio">' +
      escapeHtml(s.description || '') + '</textarea></div>' +
      '<div class="field-row">' +
      '<div class="field"><label>Periodicidad</label><select id="mPeriodicity">' +
      '<option value="monthly"' + ((s.periodicity || 'monthly') === 'monthly' ? ' selected' : '') + '>Mensual</option>' +
      '<option value="quarterly"' + (s.periodicity === 'quarterly' ? ' selected' : '') + '>Trimestral</option>' +
      '<option value="yearly"' + (s.periodicity === 'yearly' ? ' selected' : '') + '>Anual</option></select></div>' +
      '<div class="field"><label>Día de cobro (1-28)</label><input id="mBillingDay" type="number" min="1" max="28" value="' + (s.billingDay || 1) + '"></div></div>' +
      '<div class="field-row">' +
      '<div class="field"><label>Monto *</label><input id="mAmount" type="number" min="0" step="0.01" value="' + (s.amountMonthly != null ? s.amountMonthly : '') + '"></div>' +
      '<div class="field"><label>Moneda</label><select id="mCurrency"><option value="CRC"' + ((s.currency || 'CRC') === 'CRC' ? ' selected' : '') + '>Colones (CRC)</option>' +
      '<option value="USD"' + (s.currency === 'USD' ? ' selected' : '') + '>Dólares (USD)</option></select></div></div>' +
      '<div id="mRateWrap" class="field" style="display:none">' +
      '<label>Tipo de cambio (₡ por $1)</label>' +
      '<input id="mExchangeRate" type="number" min="1" step="0.01" placeholder="Vacío = usar el global (' + defaultRate() + ')">' +
      '<p id="mCrcPreview" style="font-size:0.9rem;color:#4a5a5b;margin:8px 0 0"></p></div>' +
      '<div class="field"><label><input type="checkbox" id="mSvcActive" ' + (s.active !== false ? ' checked' : '') + '> Activo</label></div>' +
      '<p style="font-size:0.85rem;color:#7a8889">Los cobros mensuales automáticos aplican solo a periodicidad <strong>Mensual</strong>. Resumen siempre en colones.</p>',
      'service',
      s.id || null
    );
    modalBackdrop.dataset.clientId = clientId;
    if (s.exchangeRate != null) {
      setTimeout(function () {
        var r = document.getElementById('mExchangeRate');
        if (r) r.value = rateVal;
        bindServiceModalFields();
      }, 0);
    }
  }

  function saveModal() {
    if (modalMode === 'client') {
      var name = document.getElementById('mName').value.trim();
      if (!name) { alert('Nombre obligatorio.'); return; }
      var payload = {
        name: name,
        active: document.getElementById('mActive').checked
      };
      if (modalEntityId) Object.assign(clientById(modalEntityId), payload);
      else {
        payload.id = uid();
        payload.createdAt = new Date().toISOString();
        state.data.clients.push(payload);
        state.selectedClientId = payload.id;
      }
    } else if (modalMode === 'service') {
      var svcName = document.getElementById('mSvcName').value.trim();
      var amount = Number(document.getElementById('mAmount').value);
      var currency = document.getElementById('mCurrency').value;
      var day = Math.min(28, Math.max(1, Number(document.getElementById('mBillingDay').value) || 1));
      var rateInput = document.getElementById('mExchangeRate').value.trim();
      if (!svcName || !(amount >= 0)) { alert('Nombre y monto obligatorios.'); return; }
      var exchangeRate = currency === 'USD' && rateInput !== '' ? Number(rateInput) : null;
      var rateUsed = currency === 'USD' ? (exchangeRate != null ? exchangeRate : defaultRate()) : null;
      var payloadSvc = {
        clientId: modalBackdrop.dataset.clientId,
        name: svcName,
        description: document.getElementById('mSvcDesc').value.trim(),
        amountMonthly: amount,
        currency: currency,
        exchangeRate: exchangeRate,
        periodicity: document.getElementById('mPeriodicity').value,
        billingDay: day,
        active: document.getElementById('mSvcActive').checked
      };
      var svcId;
      if (modalEntityId) {
        Object.assign(serviceById(modalEntityId), payloadSvc);
        svcId = modalEntityId;
      } else {
        payloadSvc.id = uid();
        state.data.services.push(payloadSvc);
        svcId = payloadSvc.id;
      }
      var period = periodNow();
      state.data.payments.forEach(function (p) {
        if (p.serviceId !== svcId || p.period !== period || p.status === 'paid') return;
        var rate = currency === 'USD' ? rateUsed : null;
        p.amount = amount;
        p.currency = currency;
        p.exchangeRate = rate;
        p.amountCrc = amountToCrc(amount, currency, rate);
        if (!paymentDescription(p)) p.description = payloadSvc.description || '';
      });
    } else if (modalMode === 'payment') {
      var p = state.data.payments.find(function (x) { return x.id === modalEntityId; });
      if (p) {
        p.description = document.getElementById('mPayDesc').value.trim();
        p.notes = p.description;
      }
    closeModal();
    persist().then(ensureMonthPayments);
  }

  // ---- Events ----
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('emailInput').value.trim();
      var password = document.getElementById('passwordInput').value;
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auth', email: email, password: password })
      })
        .then(function (r) { return r.json(); })
        .then(function (json) {
          if (json.ok) {
            setAuthed(true, email, password);
            loginError.hidden = true;
            showShell();
          } else {
            loginError.hidden = false;
            loginError.textContent = 'Correo o contraseña incorrectos.';
          }
        })
        .catch(function () {
          loginError.hidden = false;
          loginError.textContent = 'Sin servidor local. Corré npm start y revisá data/auth.local.json';
        });
    });
  }

  document.getElementById('btnLogout').addEventListener('click', showLogin);

  document.getElementById('btnSaveRate').addEventListener('click', function () {
    var v = Number(document.getElementById('defaultExchangeRate').value);
    if (!(v > 0)) { alert('Tipo de cambio inválido.'); return; }
    state.data.settings.defaultExchangeRate = v;
    persist();
  });

  document.getElementById('btnSaveRetention').addEventListener('click', function () {
    state.data.settings.retentionMonths = Number(document.getElementById('retentionMonths').value);
    state.data.settings.autoPurge = document.getElementById('autoPurge').checked;
    persist().then(function () { alert('Política de retención guardada.'); });
  });

  document.getElementById('btnPurgeNow').addEventListener('click', function () {
    if (!retentionMonths()) {
      alert('Tenés «Sin límite» activo. Cambiá los meses de conservación primero.');
      return;
    }
    var cut = cutoffPeriod();
    if (!confirm('¿Borrar cobros con período anterior a ' + cut + '? La bitácora perderá esos registros.')) return;
    var n = purgeOldPayments();
    if (n === 0) {
      alert('No había registros antiguos para borrar.');
      renderAll();
      return;
    }
    persist().then(function () {
      alert('Se eliminaron ' + n + ' registro(s) antiguos.');
    });
  });

  document.getElementById('btnNewClient').addEventListener('click', function () { openClientModal(null); });
  document.getElementById('btnGenMonth').addEventListener('click', function () {
    ensureMonthPayments().then(function () {
      renderAll();
      alert('Cobros del mes listos.');
    });
  });

  var btnExport = document.getElementById('btnExport');
  if (btnExport) {
    btnExport.addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'exha-cobros-' + periodNow() + '.json';
      a.click();
    });
  }

  var btnImport = document.getElementById('btnImport');
  var importFile = document.getElementById('importFile');
  if (btnImport && importFile) {
    btnImport.addEventListener('click', function () { importFile.click(); });
    importFile.addEventListener('change', function () {
      var file = importFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(reader.result);
          if (!confirm('¿Reemplazar datos en el archivo del servidor?')) return;
          state.data = parsed;
          if (!state.data.settings) state.data.settings = { defaultExchangeRate: 520 };
          persist().then(function () { alert('Importado.'); });
        } catch (err) {
          alert('JSON inválido.');
        }
        importFile.value = '';
      };
      reader.readAsText(file);
    });
  }

  navButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { switchPanel(btn.getAttribute('data-panel')); });
  });
  if (modalSave) modalSave.addEventListener('click', saveModal);
  if (modalCancel) modalCancel.addEventListener('click', closeModal);
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', function (e) {
      if (e.target === modalBackdrop) closeModal();
    });
  }

  if (isAuthed()) showShell();
  else showLogin();
})();
