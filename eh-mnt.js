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

  // Yurguen: nombres cortos de mes para cobros anuales/trimestrales
  var MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  var state = {
    data: { settings: { defaultExchangeRate: 520 }, clients: [], services: [], payments: [] },
    selectedClientId: null,
    paymentTab: 'current',
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

  function ivaPercent() {
    var v = state.data.settings && state.data.settings.ivaPercent;
    return v != null ? Number(v) : 13;
  }

  // Yurguen: tx del pago o del servicio vinculado (USD)
  function resolveItemIntlTx(item, svc) {
    if ((item.currency || 'CRC') !== 'USD') return 0;
    var v = item.intlTxPercent;
    if ((v == null || v === '') && svc) v = svc.intlTxPercent;
    if (v == null || v === '') return 0;
    var n = Number(v);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  // Yurguen: monto de servicio (amountMonthly) o de pago (amount)
  function itemAmount(item) {
    if (item.amount != null && item.amount !== '') return Number(item.amount);
    if (item.amountMonthly != null && item.amountMonthly !== '') return Number(item.amountMonthly);
    return 0;
  }

  // Yurguen: servicio exonerado no lleva IVA en el total
  function resolveItemIvaExempt(item, svc) {
    if (item.ivaExempt === true) return true;
    if (svc && svc.ivaExempt === true) return true;
    return false;
  }

  function paymentBaseCrc(item) {
    if (item.amountCrc != null && item.amountCrc !== '') return Number(item.amountCrc);
    var cur = item.currency || 'CRC';
    var rate = cur === 'USD' ? resolveRate(item) : null;
    return amountToCrc(itemAmount(item), cur, rate);
  }

  function calcFinalCrc(baseCrc, currency, intlPct, ivaExempt) {
    var base = Number(baseCrc) || 0;
    var iva = ivaExempt ? 0 : Math.round(base * ivaPercent() / 100);
    var pct = currency === 'USD' ? (Number(intlPct) || 0) : 0;
    var intl = pct > 0 ? Math.round(base * pct / 100) : 0;
    return { base: base, iva: iva, intl: intl, total: base + iva + intl, ivaExempt: !!ivaExempt };
  }

  function paymentTotalCrc(p, svc) {
    return calcFinalCrc(
      paymentBaseCrc(p),
      p.currency || 'CRC',
      resolveItemIntlTx(p, svc),
      resolveItemIvaExempt(p, svc)
    ).total;
  }

  function formatTotalDisplay(item, svc) {
    var cur = item.currency || 'CRC';
    var exempt = resolveItemIvaExempt(item, svc);
    var parts = calcFinalCrc(paymentBaseCrc(item), cur, resolveItemIntlTx(item, svc), exempt);
    var html = '<strong>' + formatMoney(parts.total, 'CRC') + '</strong>';
    var extras = [];
    if (parts.iva) extras.push('IVA ' + formatMoney(parts.iva, 'CRC'));
    if (parts.intl) extras.push('Tx ' + formatMoney(parts.intl, 'CRC'));
    if (extras.length) {
      html += '<br><small>Base ' + formatMoney(parts.base, 'CRC') + ' + ' + extras.join(' + ') + '</small>';
    } else if (exempt) {
      html += '<br><small>Sin IVA (exonerado)</small>';
    }
    if (cur === 'USD') {
      html += '<br><small>' + formatMoney(itemAmount(item), 'USD') + '</small>';
    }
    return html;
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

  // Yurguen: mensaje legible con lo que devolvió la API
  function describeApiResult(status, json, fallback) {
    var parts = [];
    if (status) parts.push('HTTP ' + status);
    if (json && json.error) parts.push(String(json.error));
    if (json && json.ok === false) parts.push('ok: false');
    if (!parts.length && fallback) parts.push(fallback);
    return parts.join(' — ') || 'Error desconocido';
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
        if (!res.ok) {
          var err = new Error(describeApiResult(res.status, json, 'Error de servidor'));
          err.status = res.status;
          err.json = json;
          throw err;
        }
        return json;
      }).catch(function (parseErr) {
        if (parseErr.status) throw parseErr;
        var err = new Error('HTTP ' + res.status + ' — respuesta no válida');
        err.status = res.status;
        throw err;
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
    if (s.retentionMonths == null) s.retentionMonths = 12;
    if (s.autoPurge == null) s.autoPurge = true;
    if (s.ivaPercent == null) s.ivaPercent = 13;
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
    var amt = itemAmount(svc);
    return {
      id: uid(),
      serviceId: svc.id,
      period: period,
      amount: amt,
      currency: cur,
      exchangeRate: cur === 'USD' ? rate : null,
      intlTxPercent: cur === 'USD' && svc.intlTxPercent != null && svc.intlTxPercent !== ''
        ? Number(svc.intlTxPercent) : null,
      ivaExempt: !!svc.ivaExempt,
      amountCrc: amountToCrc(amt, cur, rate),
      status: 'pending',
      paidAt: null,
      description: svc.description || '',
      notes: ''
    };
  }

  function serviceDueInPeriod(svc, period) {
    var per = svc.periodicity || 'monthly';
    var month = Number(String(period).split('-')[1]);
    if (per === 'monthly') return true;
    var start = Number(svc.billingMonth) || 1;
    if (per === 'yearly') return month === start;
    if (per === 'quarterly') return ((month - start + 12) % 12) % 3 === 0;
    return false;
  }

  // Yurguen: un cobro solo aplica si el servicio corresponde en ese período
  function paymentAppliesToPeriod(p, svc) {
    return !!(svc && serviceDueInPeriod(svc, p.period));
  }

  function pruneInvalidPayments() {
    var before = state.data.payments.length;
    state.data.payments = state.data.payments.filter(function (p) {
      var svc = serviceById(p.serviceId);
      if (!svc) return false;
      if (paymentAppliesToPeriod(p, svc)) return true;
      return p.status === 'paid';
    });
    return before - state.data.payments.length;
  }

  function formatBillingSchedule(svc) {
    var per = svc.periodicity || 'monthly';
    var day = svc.billingDay || 1;
    if (per === 'yearly' || per === 'quarterly') {
      var m = Number(svc.billingMonth) || 1;
      return MONTH_NAMES[m - 1] + ', día ' + day;
    }
    return 'Día ' + day;
  }

  function monthSelectHtml(selected) {
    var sel = Number(selected) || 1;
    return MONTH_NAMES.map(function (name, i) {
      var v = i + 1;
      return '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + name + '</option>';
    }).join('');
  }

  function syncPaymentFromService(p, svc) {
    var rate = resolveRate(svc);
    var cur = svc.currency || 'CRC';
    var amt = itemAmount(svc);
    p.amount = amt;
    p.currency = cur;
    p.exchangeRate = cur === 'USD' ? rate : null;
    p.intlTxPercent = cur === 'USD' && svc.intlTxPercent != null && svc.intlTxPercent !== ''
      ? Number(svc.intlTxPercent) : null;
    p.ivaExempt = !!svc.ivaExempt;
    p.amountCrc = amountToCrc(amt, cur, rate);
    if (!paymentDescription(p)) p.description = svc.description || '';
  }

  function shiftPeriod(period, deltaMonths) {
    var parts = String(period).split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1 + deltaMonths, 1, 12, 0, 0, 0);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // Yurguen: anterior, actual y posterior para la tabla de pagos
  function paymentViewPeriods() {
    var cur = periodNow();
    return [shiftPeriod(cur, -1), cur, shiftPeriod(cur, 1)];
  }

  function periodForPaymentTab(tab) {
    var cur = periodNow();
    if (tab === 'prev') return shiftPeriod(cur, -1);
    if (tab === 'next') return shiftPeriod(cur, 1);
    return cur;
  }

  function paymentNeedsSync(p, svc) {
    if (Math.abs(itemAmount(p) - itemAmount(svc)) > 0.001) return true;
    if ((p.currency || 'CRC') !== (svc.currency || 'CRC')) return true;
    if (!!p.ivaExempt !== !!svc.ivaExempt) return true;
    var svcIntl = svc.currency === 'USD' && svc.intlTxPercent != null && svc.intlTxPercent !== ''
      ? Number(svc.intlTxPercent) : null;
    var payIntl = p.intlTxPercent != null && p.intlTxPercent !== '' ? Number(p.intlTxPercent) : null;
    if (svcIntl !== payIntl) return true;
    return false;
  }

  function repairPaymentIfNeeded(p, svc) {
    if (!paymentAppliesToPeriod(p, svc)) return;
    if (p.status !== 'paid' || paymentNeedsSync(p, svc)) {
      syncPaymentFromService(p, svc);
    }
  }

  function repairAllPaymentsFromServices() {
    state.data.services.forEach(function (svc) {
      if (svc.active === false) return;
      state.data.payments.forEach(function (p) {
        if (p.serviceId === svc.id) repairPaymentIfNeeded(p, svc);
      });
    });
  }

  function ensureMonthPayments() {
    pruneInvalidPayments();
    repairAllPaymentsFromServices();
    paymentViewPeriods().forEach(function (period) {
      state.data.services.forEach(function (svc) {
        if (svc.active === false) return;
        if (!serviceDueInPeriod(svc, period)) return;
        var existing = state.data.payments.find(function (p) {
          return p.serviceId === svc.id && p.period === period;
        });
        if (!existing) {
          state.data.payments.push(paymentFromService(svc, period));
        }
      });
    });
    return saveData().then(loadData);
  }

  function paymentStatus(p, svc) {
    if (p.status === 'paid') return 'paid';
    var day = Math.min(28, Math.max(1, Number(svc && svc.billingDay) || 1));
    var parts = String(p.period).split('-');
    var due = new Date(Number(parts[0]), Number(parts[1]) - 1, day, 12, 0, 0, 0);
    var now = new Date();
    now.setHours(12, 0, 0, 0);
    if (now > due) return 'overdue';
    return 'pending';
  }

  // Yurguen: gasto (negativo) = pagado; ingreso (positivo) = cobrado
  function isExpense(item, svc) {
    return itemAmount(item) < 0;
  }

  function paidStatusLabel(item, svc) {
    return isExpense(item, svc) ? 'Pagado' : 'Cobrado';
  }

  function payActionLabel(item, svc, done) {
    if (done) return 'Pendiente';
    return isExpense(item, svc) ? 'Pagado' : 'Cobrado';
  }

  function formatPeriodLabel(period) {
    var parts = String(period).split('-');
    if (parts.length !== 2) return period;
    return MONTH_NAMES[Number(parts[1]) - 1] + ' ' + parts[0];
  }

  function formatBillingDate(svc, period) {
    var day = Math.min(28, Math.max(1, Number(svc.billingDay) || 1));
    var parts = String(period).split('-');
    return String(day).padStart(2, '0') + '/' + String(parts[1]).padStart(2, '0') + '/' + parts[0];
  }

  function billingDueTime(svc, period) {
    var day = Math.min(28, Math.max(1, Number(svc.billingDay) || 1));
    var parts = String(period).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, day, 12, 0, 0, 0).getTime();
  }

  // Yurguen: días hasta el día de cobro del mes (negativo = ya venció)
  function daysUntilBilling(svc, period) {
    var now = new Date();
    now.setHours(12, 0, 0, 0);
    return Math.round((billingDueTime(svc, period) - now.getTime()) / 86400000);
  }

  function sortPaymentRows(rows) {
    return rows.sort(function (a, b) {
      if (a.p.status === 'paid' && b.p.status !== 'paid') return 1;
      if (a.p.status !== 'paid' && b.p.status === 'paid') return -1;
      var da = billingDueTime(a.svc, a.p.period);
      var db = billingDueTime(b.svc, b.p.period);
      if (da !== db) return da - db;
      var na = a.client ? a.client.name : '';
      var nb = b.client ? b.client.name : '';
      return na.localeCompare(nb);
    });
  }

  function serviceTotalCrc(svc) {
    var draft = {
      amount: itemAmount(svc),
      amountMonthly: svc.amountMonthly,
      currency: svc.currency || 'CRC',
      exchangeRate: svc.currency === 'USD' ? resolveRate(svc) : null,
      intlTxPercent: svc.intlTxPercent,
      ivaExempt: svc.ivaExempt
    };
    return paymentTotalCrc(draft, svc);
  }

  function sortServicesAsc(services) {
    return services.slice().sort(function (a, b) {
      var diff = serviceTotalCrc(a) - serviceTotalCrc(b);
      if (diff !== 0) return diff;
      return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
    });
  }

  function paymentCrc(p, svc) {
    return paymentTotalCrc(p, svc);
  }

  // Yurguen: monto calculado de un servicio que corresponde en el período
  function crcForDueItem(svc, period) {
    var p = state.data.payments.find(function (x) {
      return x.serviceId === svc.id && x.period === period;
    });
    if (p) return paymentCrc(p, svc);
    var draft = {
      amount: itemAmount(svc),
      amountMonthly: svc.amountMonthly,
      currency: svc.currency || 'CRC',
      exchangeRate: svc.currency === 'USD' ? resolveRate(svc) : null,
      intlTxPercent: svc.intlTxPercent,
      ivaExempt: svc.ivaExempt
    };
    return paymentTotalCrc(draft, svc);
  }

  // Yurguen: resumen del mes solo con servicios que tocan cobrar/pagar en el período
  function computePeriodStats(period) {
    var stats = {
      cobradoDone: 0,
      cobradoPending: 0,
      pagadoDone: 0,
      pagadoPending: 0
    };
    state.data.services.forEach(function (svc) {
      if (svc.active === false) return;
      if (!serviceDueInPeriod(svc, period)) return;
      var crc = crcForDueItem(svc, period);
      var p = state.data.payments.find(function (x) {
        return x.serviceId === svc.id && x.period === period;
      });
      var paid = p && p.status === 'paid';
      if (isExpense(svc, svc)) {
        if (paid) stats.pagadoDone += crc;
        else stats.pagadoPending += crc;
      } else if (paid) stats.cobradoDone += crc;
      else stats.cobradoPending += crc;
    });
    stats.netDone = stats.cobradoDone + stats.pagadoDone;
    stats.netMonth = stats.cobradoDone + stats.cobradoPending + stats.pagadoDone + stats.pagadoPending;
    return stats;
  }

  function setStatMoney(el, amount, showAbs) {
    if (!el) return;
    var n = showAbs ? Math.abs(Number(amount) || 0) : Number(amount) || 0;
    el.textContent = formatMoney(n, 'CRC');
  }

  function setNetStatCard(el, amount) {
    if (!el) return;
    var card = el.closest('.stat-card');
    var n = Number(amount) || 0;
    el.textContent = formatMoney(n, 'CRC');
    if (card) {
      card.classList.remove('stat-card--negative', 'stat-card--positive');
      if (n < 0) card.classList.add('stat-card--negative');
      else if (n > 0) card.classList.add('stat-card--positive');
    }
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
  var modalDelete = document.getElementById('modalDelete');
  var modalMode = null;
  var modalEntityId = null;

  function showApiError(msg) {
    if (apiError) {
      apiError.hidden = !msg;
      apiError.textContent = msg || '';
    }
  }

  function showLoginError(msg) {
    if (!loginError) return;
    loginError.textContent = msg || '';
    loginError.style.display = msg ? 'block' : 'none';
  }

  function doLogin() {
    var emailEl = document.getElementById('emailInput');
    var passEl = document.getElementById('passwordInput');
    var email = emailEl ? emailEl.value.trim() : '';
    var password = passEl ? passEl.value : '';
    var btn = document.getElementById('loginBtn');

    if (!email || !password) {
      showLoginError('Completá correo y contraseña.');
      return;
    }

    var btnText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
    showLoginError('Conectando...');

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'auth', email: email, password: password })
    })
      .then(function (r) {
        return r.text().then(function (text) {
          var json = null;
          try { json = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
          return { status: r.status, ok: r.ok, json: json, raw: text };
        });
      })
      .then(function (res) {
        if (res.json && res.json.ok) {
          showLoginError('');
          setAuthed(true, email, password);
          showShell();
          return;
        }
        var detail = describeApiResult(res.status, res.json, null);
        if (!res.json && res.raw) {
          detail += (res.raw.length > 120 ? ' — ' + res.raw.slice(0, 120) + '…' : ' — ' + res.raw);
        }
        showLoginError(detail || 'Credenciales rechazadas');
      })
      .catch(function (err) {
        var hint = location.hostname === 'localhost' ? '' : ' (¿Estás en localhost con npm start?)';
        showLoginError('Sin respuesta — ' + (err.message || String(err)) + hint);
      })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = btnText; }
      });
  }

  function enterPanel() {
    showApiError('');
    return loadData()
      .then(function () {
        if (state.data.settings.autoPurge !== false) {
          var n = purgeOldPayments();
          if (n > 0) return saveData().then(loadData);
        }
      })
      .then(function () { return ensureMonthPayments(); })
      .then(function () {
        loginView.style.display = 'none';
        shell.classList.add('active');
        renderAll();
      });
  }

  function showShell() {
    enterPanel().catch(function (err) {
      showLoginError(describeApiResult(
        err && err.status,
        err && err.json,
        (err && err.message) || 'No se pudieron cargar los datos después del login'
      ));
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
    var rateInp = document.getElementById('defaultExchangeRate');
    var ivaInp = document.getElementById('ivaPercent');
    if (rateInp) rateInp.value = defaultRate();
    if (ivaInp) ivaInp.value = ivaPercent();
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
        hint.textContent = 'Sin límite: la bitácora no se borra sola.';
      } else {
        hint.textContent = 'Limpieza automática: se borran cobros con más de 12 meses.';
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
        '<td>' + formatTotalDisplay(row.p, row.svc) + '</td></tr>';
    }).join('');
  }

  function formatDateCr(iso) {
    var parts = String(iso).slice(0, 10).split('-');
    if (parts.length !== 3) return iso;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function renderStats() {
    var period = periodNow();
    var stats = computePeriodStats(period);
    setStatMoney(document.getElementById('statCobradoDone'), stats.cobradoDone, false);
    setStatMoney(document.getElementById('statCobradoPending'), stats.cobradoPending, false);
    setStatMoney(document.getElementById('statPagadoDone'), stats.pagadoDone, true);
    setStatMoney(document.getElementById('statPagadoPending'), stats.pagadoPending, true);
    setNetStatCard(document.getElementById('statNetDone'), stats.netDone);
    setNetStatCard(document.getElementById('statNetMonth'), stats.netMonth);
    var elClients = document.getElementById('statClients');
    var periodLabel = document.getElementById('periodLabel');
    if (elClients) elClients.textContent = String(state.data.clients.filter(function (c) { return c.active !== false; }).length);
    if (periodLabel) periodLabel.textContent = formatPeriodLabel(period);
    renderExchangeSettings();
    renderRetentionSettings();
  }

  function renderPaymentsTabs() {
    var wrap = document.getElementById('paymentsTabs');
    if (!wrap) return;
    var cur = periodNow();
    var tabs = [
      { key: 'prev', period: shiftPeriod(cur, -1), label: 'Mes anterior' },
      { key: 'current', period: cur, label: 'Mes actual' },
      { key: 'next', period: shiftPeriod(cur, 1), label: 'Mes posterior' }
    ];
    wrap.innerHTML = tabs.map(function (t) {
      var active = state.paymentTab === t.key ? ' active' : '';
      return '<button type="button" class="payments-tab' + active + '" data-pay-tab="' + t.key + '">' +
        '<span>' + t.label + '</span><small>' + formatPeriodLabel(t.period) + '</small></button>';
    }).join('');
    wrap.querySelectorAll('[data-pay-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.paymentTab = btn.getAttribute('data-pay-tab');
        renderPaymentsTable();
      });
    });
  }

  function renderPaymentsTable() {
    var tbody = document.getElementById('paymentsBody');
    var tfoot = document.getElementById('paymentsFoot');
    if (!tbody) return;
    renderPaymentsTabs();
    var period = periodForPaymentTab(state.paymentTab);
    var rows = state.data.payments
      .filter(function (p) { return p.period === period; })
      .map(function (p) {
        var svc = serviceById(p.serviceId);
        if (!svc || !paymentAppliesToPeriod(p, svc)) return null;
        return { p: p, svc: svc, client: clientById(svc.clientId), st: paymentStatus(p, svc) };
      })
      .filter(Boolean);
    sortPaymentRows(rows);

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No hay cobros en ' + escapeHtml(formatPeriodLabel(period)) + '.</td></tr>';
      if (tfoot) tfoot.innerHTML = '';
      return;
    }

    var sumTotal = 0;
    var sumIncome = 0;
    var sumExpense = 0;

    tbody.innerHTML = rows.map(function (row) {
      var crc = paymentCrc(row.p, row.svc);
      sumTotal += crc;
      if (isExpense(row.p, row.svc)) sumExpense += crc;
      else sumIncome += crc;

      var badgeClass = row.st === 'paid' ? 'badge-paid' : (row.st === 'overdue' ? 'badge-overdue' : 'badge-pending');
      var badgeText = row.st === 'paid' ? paidStatusLabel(row.p, row.svc) : (row.st === 'overdue' ? 'Vencido' : 'Pendiente');
      var per = PERIOD_LABELS[row.svc.periodicity || 'monthly'] || 'Mensual';
      var desc = paymentDescription(row.p);
      var done = row.p.status === 'paid';
      var payBtn = done
        ? '<button type="button" class="btn btn-outline btn-sm" data-unpay="' + row.p.id + '">' + payActionLabel(row.p, row.svc, true) + '</button>'
        : '<button type="button" class="btn btn-primary btn-sm" data-pay="' + row.p.id + '">' + payActionLabel(row.p, row.svc, false) + '</button>';
      return '<tr>' +
        '<td><strong>' + escapeHtml(row.client ? row.client.name : '—') + '</strong></td>' +
        '<td>' + escapeHtml(row.svc.name) + '</td>' +
        '<td class="desc-cell">' + escapeHtml(desc || '—') +
        ' <button type="button" class="btn btn-outline btn-sm" data-edit-pay="' + row.p.id + '">Editar</button></td>' +
        '<td>' + per + '</td>' +
        '<td>' + formatBillingDate(row.svc, row.p.period) + '</td>' +
        '<td>' + formatTotalDisplay(row.p, row.svc) + '</td>' +
        '<td><span class="badge-status ' + badgeClass + '">' + badgeText + '</span></td>' +
        '<td>' + payBtn + '</td></tr>';
    }).join('');

    if (tfoot) {
      tfoot.innerHTML = '<tr class="payments-total-row">' +
        '<td colspan="5"><strong>Sumatoria — ' + escapeHtml(formatPeriodLabel(period)) + '</strong></td>' +
        '<td><strong>' + formatMoney(sumTotal, 'CRC') + '</strong>' +
        '<br><small>Ingresos: ' + formatMoney(sumIncome, 'CRC') + ' · Gastos: ' + formatMoney(sumExpense, 'CRC') + '</small></td>' +
        '<td colspan="2"></td></tr>';
    }

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
      return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
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
    var services = sortServicesAsc(state.data.services.filter(function (s) { return s.clientId === c.id; }));
    var svcHtml = services.length
      ? '<table class="admin-table"><thead><tr><th>Servicio</th><th>Periodicidad</th><th>Cobro/mes</th><th>Día</th><th></th></tr></thead><tbody>' +
        services.map(function (s) {
          return '<tr><td>' + escapeHtml(s.name) + '</td>' +
            '<td>' + (PERIOD_LABELS[s.periodicity || 'monthly'] || 'Mensual') + '</td>' +
            '<td>' + formatTotalDisplay(s) + '</td>' +
            '<td>' + formatBillingSchedule(s) + '</td>' +
            '<td><button type="button" class="btn btn-outline btn-sm" data-edit-svc="' + s.id + '">Editar</button></td></tr>';
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
    var modalEl = modalBackdrop && modalBackdrop.querySelector('.modal');
    if (modalEl) modalEl.classList.toggle('modal--wide', mode === 'service');
    if (modalDelete) {
      modalDelete.hidden = !(mode === 'service' && id);
      modalDelete.textContent = 'Quitar servicio';
    }
    modalBackdrop.classList.add('open');
  }

  function closeModal() {
    modalBackdrop.classList.remove('open');
    var modalEl = modalBackdrop && modalBackdrop.querySelector('.modal');
    if (modalEl) modalEl.classList.remove('modal--wide');
    if (modalDelete) modalDelete.hidden = true;
    modalMode = null;
    modalEntityId = null;
  }

  // Yurguen: quitar servicio solo desde el modal (evita clics accidentales)
  function deleteServiceFromModal() {
    if (modalMode !== 'service' || !modalEntityId) return;
    if (!confirm('¿Quitar este servicio y todos sus cobros?')) return;
    var sid = modalEntityId;
    state.data.services = state.data.services.filter(function (s) { return s.id !== sid; });
    state.data.payments = state.data.payments.filter(function (p) { return p.serviceId !== sid; });
    closeModal();
    persist().then(ensureMonthPayments);
  }

  function bindServiceModalFields() {
    var cur = document.getElementById('mCurrency');
    var wrap = document.getElementById('mIntlWrap');
    var monthWrap = document.getElementById('mMonthWrap');
    var periodicity = document.getElementById('mPeriodicity');
    var preview = document.getElementById('mCrcPreview');
    var scheduleHint = document.getElementById('mScheduleHint');

    function refreshPeriodicity() {
      var per = periodicity ? periodicity.value : 'monthly';
      var showMonth = per === 'yearly' || per === 'quarterly';
      if (monthWrap) monthWrap.style.display = showMonth ? '' : 'none';
      if (scheduleHint) scheduleHint.style.display = showMonth ? '' : 'none';
    }

    function refresh() {
      refreshPeriodicity();
      var isUsd = cur && cur.value === 'USD';
      var rateField = document.getElementById('mRateField');
      if (rateField) rateField.style.display = isUsd ? '' : 'none';
      if (wrap) wrap.style.display = isUsd ? '' : 'none';
      if (preview) {
        var amt = Number(document.getElementById('mAmount').value);
        if (document.getElementById('mAmount').value.trim() === '' || isNaN(amt)) {
          preview.textContent = '';
          return;
        }
        var rate = Number(document.getElementById('mExchangeRate').value) || defaultRate();
        var intlRaw = document.getElementById('mIntlTxPercent');
        var intlPct = intlRaw && intlRaw.value.trim() !== '' ? parseFloat(intlRaw.value) : 0;
        var exempt = document.getElementById('mSvcIvaExempt') && document.getElementById('mSvcIvaExempt').checked;
        var total = calcFinalCrc(
          amountToCrc(amt, isUsd ? 'USD' : 'CRC', rate),
          isUsd ? 'USD' : 'CRC',
          isUsd ? intlPct : 0,
          exempt
        ).total;
        preview.textContent = 'Total estimado: ' + formatMoney(total, 'CRC') +
          (exempt ? ' (sin IVA)' : ' (base + IVA' + (isUsd && intlPct > 0 ? ' + tx ' + intlPct + '%' : '') + ')');
      }
    }
    if (periodicity) periodicity.onchange = refresh;
    if (cur) cur.onchange = refresh;
    var exemptEl = document.getElementById('mSvcIvaExempt');
    if (exemptEl) exemptEl.onchange = refresh;
    ['mAmount', 'mExchangeRate', 'mIntlTxPercent'].forEach(function (id) {
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
      '<div class="field-row field-row-svc">' +
      '<div class="field"><label>Periodicidad</label><select id="mPeriodicity">' +
      '<option value="monthly"' + ((s.periodicity || 'monthly') === 'monthly' ? ' selected' : '') + '>Mensual</option>' +
      '<option value="quarterly"' + (s.periodicity === 'quarterly' ? ' selected' : '') + '>Trimestral</option>' +
      '<option value="yearly"' + (s.periodicity === 'yearly' ? ' selected' : '') + '>Anual</option></select></div>' +
      '<div class="field" id="mMonthWrap" style="display:none"><label>Mes de cobro</label><select id="mBillingMonth">' +
      monthSelectHtml(s.billingMonth) + '</select></div>' +
      '<div class="field"><label>Día de cobro (1-28)</label><input id="mBillingDay" type="number" min="1" max="28" value="' + (s.billingDay || 1) + '"></div></div>' +
      '<div class="field-row field-row-svc">' +
      '<div class="field"><label>Monto * <small>(negativo = gasto)</small></label><input id="mAmount" type="number" step="0.01" value="' + (s.amountMonthly != null ? s.amountMonthly : '') + '"></div>' +
      '<div class="field"><label>Moneda</label><select id="mCurrency"><option value="CRC"' + ((s.currency || 'CRC') === 'CRC' ? ' selected' : '') + '>Colones (CRC)</option>' +
      '<option value="USD"' + (s.currency === 'USD' ? ' selected' : '') + '>Dólares (USD)</option></select></div>' +
      '<div class="field" id="mRateField" style="display:none"><label>Tipo de cambio (₡ por $1)</label>' +
      '<input id="mExchangeRate" type="number" min="1" step="any" placeholder="Vacío = global (' + defaultRate() + ')"></div></div>' +
      '<div id="mIntlWrap" class="field-row field-row-svc" style="display:none">' +
      '<div class="field"><label>Tx internacional (%)</label>' +
      '<input id="mIntlTxPercent" type="number" min="0" max="100" step="any" placeholder="Vacío = sin cargo" value="' +
      (s.intlTxPercent != null ? s.intlTxPercent : '') + '"></div></div>' +
      '<p id="mCrcPreview" style="font-size:0.9rem;color:#4a5a5b;margin:0 0 8px"></p>' +
      '<div class="field-row field-row-checks">' +
      '<div class="field"><label><input type="checkbox" id="mSvcActive" ' + (s.active !== false ? ' checked' : '') + '> Activo</label></div>' +
      '<div class="field"><label><input type="checkbox" id="mSvcIvaExempt" ' + (s.ivaExempt ? ' checked' : '') + '> Exonerado (sin IVA)</label></div></div>' +
      '<p id="mScheduleHint" style="font-size:0.85rem;color:#7a8889;display:none">Anual/trimestral: elegí el <strong>mes</strong> de cobro. El cobro del mes se genera solo cuando corresponde.</p>',
      'service',
      s.id || null
    );
    modalBackdrop.dataset.clientId = clientId;
    setTimeout(function () {
      if (s.exchangeRate != null) {
        var r = document.getElementById('mExchangeRate');
        if (r) r.value = rateVal;
      }
      bindServiceModalFields();
    }, 0);
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
      var amountRaw = document.getElementById('mAmount').value.trim();
      var amount = Number(amountRaw);
      var currency = document.getElementById('mCurrency').value;
      var day = Math.min(28, Math.max(1, Number(document.getElementById('mBillingDay').value) || 1));
      var rateInput = document.getElementById('mExchangeRate').value.trim();
      var intlInput = document.getElementById('mIntlTxPercent').value.trim();
      // Yurguen: permitir montos negativos (gastos)
      if (!svcName || amountRaw === '' || isNaN(amount)) { alert('Nombre y monto obligatorios.'); return; }
      var exchangeRate = currency === 'USD' && rateInput !== '' ? Number(rateInput) : null;
      var rateUsed = currency === 'USD' ? (exchangeRate != null ? exchangeRate : defaultRate()) : null;
      var intlTx = null;
      if (currency === 'USD' && intlInput !== '') {
        intlTx = parseFloat(intlInput);
        if (isNaN(intlTx) || intlTx < 0 || intlTx > 100) { alert('Tx internacional: 0 a 100, o vacío.'); return; }
      }
      var periodicity = document.getElementById('mPeriodicity').value;
      var billingMonth = Number(document.getElementById('mBillingMonth').value) || 1;
      var payloadSvc = {
        clientId: modalBackdrop.dataset.clientId,
        name: svcName,
        description: document.getElementById('mSvcDesc').value.trim(),
        amountMonthly: amount,
        currency: currency,
        exchangeRate: exchangeRate,
        intlTxPercent: currency === 'USD' ? intlTx : null,
        periodicity: periodicity,
        billingMonth: (periodicity === 'yearly' || periodicity === 'quarterly') ? billingMonth : null,
        billingDay: day,
        active: document.getElementById('mSvcActive').checked,
        ivaExempt: document.getElementById('mSvcIvaExempt').checked
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
      var savedSvc = serviceById(svcId);
      paymentViewPeriods().forEach(function (period) {
        if (!serviceDueInPeriod(savedSvc, period)) return;
        state.data.payments.forEach(function (p) {
          if (p.serviceId !== svcId || p.period !== period || p.status === 'paid') return;
          var rate = currency === 'USD' ? rateUsed : null;
          p.amount = amount;
          p.currency = currency;
          p.exchangeRate = rate;
          p.intlTxPercent = payloadSvc.intlTxPercent;
          p.ivaExempt = payloadSvc.ivaExempt;
          p.amountCrc = amountToCrc(amount, currency, rate);
          if (!paymentDescription(p)) p.description = payloadSvc.description || '';
        });
      });
      pruneInvalidPayments();
    } else if (modalMode === 'payment') {
      var p = state.data.payments.find(function (x) { return x.id === modalEntityId; });
      if (p) {
        p.description = document.getElementById('mPayDesc').value.trim();
        p.notes = p.description;
      }
    }
    closeModal();
    persist().then(ensureMonthPayments);
  }

  // ---- Events ----
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      doLogin();
    });
  }

  var loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', function (e) {
      e.preventDefault();
      doLogin();
    });
  }

  var btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', showLogin);

  document.getElementById('btnSaveRate').addEventListener('click', function () {
    var rate = parseFloat(document.getElementById('defaultExchangeRate').value);
    var iva = parseFloat(document.getElementById('ivaPercent').value);
    if (!(rate > 0)) { alert('Tipo de cambio inválido.'); return; }
    if (isNaN(iva) || iva < 0 || iva > 100) { alert('IVA: número entre 0 y 100.'); return; }
    state.data.settings.defaultExchangeRate = rate;
    state.data.settings.ivaPercent = iva;
    persist();
  });

  document.getElementById('btnSaveRetention').addEventListener('click', function () {
    state.data.settings.retentionMonths = Number(document.getElementById('retentionMonths').value);
    state.data.settings.autoPurge = document.getElementById('autoPurge').checked;
    persist().then(function () { alert('Política de retención guardada.'); });
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
  if (modalDelete) modalDelete.addEventListener('click', deleteServiceFromModal);
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', function (e) {
      if (e.target === modalBackdrop) closeModal();
    });
  }

  if (isAuthed()) showShell();
  else {
    showLogin();
    if (location.protocol === 'file:') {
      showLoginError('Abrí http://localhost:8080/eh-mnt.html (no el archivo directo).');
    } else if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      showLoginError('Este panel solo funciona en localhost con npm start.');
    }
  }
})();
