/* Yurguen: Inventario — productos, foto, comisiones, % globales/por producto */
(function () {
  'use strict';

  var TOKEN_KEY = 'exha_session_token';
  var USER_KEY = 'exha_session_user';
  var LEGACY_TOKEN_KEYS = ['exha_budget_token', 'exha_bitacora_token'];
  var LEGACY_USER_KEYS = ['exha_budget_user', 'exha_bitacora_user'];
  var AUTH_API = (typeof location !== 'undefined' ? location.origin : '') + '/api/eh-data';
  var INV_API = (typeof location !== 'undefined' ? location.origin : '') + '/api/inventario';
  var PHOTO_API = INV_API + '/photo';

  var SPLIT_LABELS = {
    impuestos: 'Impuestos',
    exhatech: 'ExhaTech',
    vendedor: 'Vendedor',
    comision_bancaria: 'Comisión bancaria'
  };

  var state = {
    user: null,
    settings: null,
    products: [],
    purchases: [],
    orders: [],
    report: null,
    editing: null,
    modalKind: null, // 'product' | 'purchase' | 'order'
    pendingPhoto: null
  };

  var shell = document.getElementById('invShell');
  var boot = document.getElementById('invBoot');
  var apiError = document.getElementById('apiError');
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

  function rejectUnauthorized() {
    setSession('', null);
    location.replace('/');
  }

  function goHub() {
    location.replace('/');
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
    return '₡' + (Number(n) || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 });
  }

  function post(url, action, body) {
    var payload = Object.assign({ action: action }, body || {});
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': getToken()
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok || (json && json.error && res.status >= 400)) {
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

  function invApi(action, body) {
    return post(INV_API, action, body);
  }

  function photoUrl(productId) {
    // token en query: <img> no puede mandar X-Session-Token
    return PHOTO_API +
      '?id=' + encodeURIComponent(productId) +
      '&token=' + encodeURIComponent(getToken()) +
      '&t=' + Date.now();
  }

  function switchPanel(name) {
    document.querySelectorAll('.inv-nav [data-panel]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-panel') === name);
    });
    document.querySelectorAll('.inv-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
    if (name === 'reparto') {
      initReportDates();
      loadPeriodReport(true);
    }
  }

  function localDayKey(d) {
    var dt = d instanceof Date ? d : new Date();
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, '0');
    var day = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function fillSplitsForm() {
    var s = (state.settings && state.settings.splits) || {};
    var map = {
      splitImpuestos: s.impuestos != null ? s.impuestos : 13,
      splitExhatech: s.exhatech != null ? s.exhatech : 2.5,
      splitVendedor: s.vendedor != null ? s.vendedor : 10,
      splitComisionBancaria: s.comision_bancaria != null ? s.comision_bancaria : 0
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = map[id];
    });
    var meta = document.getElementById('splitsMeta');
    if (meta) {
      if (state.settings && state.settings.updatedByUsername) {
        meta.textContent = 'Último cambio: ' + state.settings.updatedByUsername +
          (state.settings.updatedAt ? ' · ' + String(state.settings.updatedAt).slice(0, 16).replace('T', ' ') : '');
      } else {
        meta.textContent = 'Defaults: Impuestos 13% · ExhaTech 2.5% · Vendedor 10% · Comisión bancaria editable.';
      }
    }
  }

  function readSplitsForm() {
    return {
      impuestos: Number(document.getElementById('splitImpuestos').value) || 0,
      exhatech: Number(document.getElementById('splitExhatech').value) || 0,
      vendedor: Number(document.getElementById('splitVendedor').value) || 0,
      comision_bancaria: Number(document.getElementById('splitComisionBancaria').value) || 0
    };
  }

  function initReportDates() {
    var toEl = document.getElementById('reportTo');
    var fromEl = document.getElementById('reportFrom');
    if (!toEl || !fromEl) return;
    var today = localDayKey(new Date());
    if (!toEl.value) toEl.value = today;
    if (!fromEl.value) {
      var start = new Date();
      start.setDate(1);
      fromEl.value = localDayKey(start);
    }
  }

  function orderStatusBadge(status, repartida) {
    if (status === 'venta') {
      return '<span class="badge-status badge-paid">Venta</span>' +
        (repartida ? ' <span class="badge-status badge-repartida">Repartida</span>' : '');
    }
    if (status === 'cancelada') return '<span class="badge-status badge-overdue">Cancelada</span>';
    return '<span class="badge-status badge-orden">Orden</span>';
  }

  function renderOrders() {
    var list = document.getElementById('ordersList');
    var empty = document.getElementById('ordersEmpty');
    if (!list) return;
    var rows = state.orders || [];
    if (!rows.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = rows.map(function (o) {
      var title = o.customerName || 'Cliente sin nombre';
      var flags = [
        o.withInvoice ? 'Con factura' : 'Sin factura',
        o.contraPedido ? 'Contra pedido' : 'Con stock'
      ].join(' · ');
      var items = (o.items || []).map(function (it) {
        return '<li>' + escapeHtml(it.productName) + ' × ' + escapeHtml(String(it.qty)) +
          ' · ' + formatMoney(it.unitPrice) + '</li>';
      }).join('');
      var actions = '';
      if (o.status === 'orden') {
        actions =
          '<button type="button" class="btn btn-primary btn-sm" data-confirm-order="' + escapeHtml(o.id) + '">Declarar venta</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-cancel-order="' + escapeHtml(o.id) + '">Cancelar</button>';
      } else if (o.status === 'venta') {
        actions =
          (o.repartida
            ? '<button type="button" class="btn btn-outline btn-sm" data-repartida-order="' + escapeHtml(o.id) + '" data-repartida="0">Quitar repartida</button>'
            : '<button type="button" class="btn btn-primary btn-sm" data-repartida-order="' + escapeHtml(o.id) + '" data-repartida="1">Marcar repartida</button>') +
          '<button type="button" class="btn btn-outline btn-sm" data-cancel-order="' + escapeHtml(o.id) + '">Anular</button>';
      }
      return '<article class="purchase-card' + (o.status === 'cancelada' ? ' is-cancelled' : '') + '">' +
        '<div class="purchase-card__head">' +
          '<div>' +
            '<h3>' + escapeHtml(title) + ' · ' + formatMoney(o.totalAmount) + '</h3>' +
            '<p class="panel-hint" style="margin:4px 0 0">' +
              escapeHtml(flags) +
              (o.customerIdNumber ? ' · ID ' + escapeHtml(o.customerIdNumber) : '') +
              (o.customerPhone ? ' · ' + escapeHtml(o.customerPhone) : '') +
              '<br>Creó: ' + escapeHtml(o.createdByUsername || '—') +
              (o.createdAt ? ' · ' + escapeHtml(String(o.createdAt).slice(0, 16).replace('T', ' ')) : '') +
              (o.status === 'venta' && o.confirmedAt
                ? '<br>Venta: ' + escapeHtml(String(o.confirmedAt).slice(0, 16).replace('T', ' ')) +
                  (o.confirmedByUsername ? ' · ' + escapeHtml(o.confirmedByUsername) : '')
                : '') +
              (o.repartida && o.repartidaByUsername
                ? '<br>Repartida por: ' + escapeHtml(o.repartidaByUsername)
                : '') +
            '</p>' +
          '</div>' +
          '<div class="order-card-actions">' +
            orderStatusBadge(o.status, o.repartida) +
            actions +
          '</div>' +
        '</div>' +
        '<ul class="purchase-card__items">' + items + '</ul>' +
      '</article>';
    }).join('');

    list.querySelectorAll('[data-confirm-order]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-confirm-order');
        if (!confirm('¿Declarar esta orden como VENTA? (pago/concretado)')) return;
        invApi('orders.confirm', { id: id })
          .then(function () { return loadBootstrap(); })
          .catch(function (err) { alert(err.message || 'No se pudo confirmar'); });
      });
    });
    list.querySelectorAll('[data-cancel-order]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-cancel-order');
        if (!confirm('¿Cancelar/anular? Si había stock reservado, vuelve al inventario.')) return;
        invApi('orders.cancel', { id: id })
          .then(function (res) {
            if (res.products) state.products = res.products;
            return loadBootstrap();
          })
          .catch(function (err) { alert(err.message || 'No se pudo cancelar'); });
      });
    });
    bindRepartidaButtons(list);
  }

  function bindRepartidaButtons(root) {
    if (!root) return;
    root.querySelectorAll('[data-repartida-order]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-repartida-order');
        var flag = btn.getAttribute('data-repartida') !== '0';
        invApi('orders.markRepartida', { id: id, repartida: flag })
          .then(function () {
            return loadBootstrap().then(function () {
              if (state.report) return loadPeriodReport(true);
            });
          })
          .catch(function (err) { alert(err.message || 'No se pudo marcar'); });
      });
    });
  }

  function reportSplitCells(parts, splits) {
    var p = parts || {};
    var s = splits || {};
    return Object.keys(SPLIT_LABELS).map(function (k) {
      var pct = s[k] != null ? ' <em>' + escapeHtml(String(s[k])) + '%</em>' : '';
      return '<td><span class="report-cell-label">' + escapeHtml(SPLIT_LABELS[k]) + pct +
        '</span><strong>' + escapeHtml(formatMoney(p[k] || 0)) + '</strong></td>';
    }).join('') +
      '<td><span class="report-cell-label">Resto</span><strong>' +
      escapeHtml(formatMoney(p.resto || 0)) + '</strong></td>';
  }

  function renderPeriodReport() {
    var summary = document.getElementById('reportSummary');
    var list = document.getElementById('reportSales');
    var empty = document.getElementById('reportEmpty');
    if (!summary || !list) return;
    var report = state.report;
    if (!report) {
      summary.hidden = true;
      list.innerHTML = '';
      if (empty) empty.hidden = true;
      return;
    }
    var t = report.totals || {};
    var parts = t.parts || {};
    var splits = report.splits || currentSplits();
    var splitColspan = Object.keys(SPLIT_LABELS).length + 1;

    summary.hidden = false;
    summary.innerHTML =
      '<table class="report-table">' +
        '<thead><tr><th>Tipo</th><th colspan="' + splitColspan + '">Detalle</th></tr></thead>' +
        '<tbody>' +
          '<tr class="report-row-ventas">' +
            '<th scope="row">Ventas</th>' +
            '<td colspan="' + splitColspan + '">' +
              '<div class="report-ventas-line">' +
                '<span><em>Cantidad</em><strong>' + escapeHtml(String(t.count || 0)) + '</strong></span>' +
                '<span><em>Total</em><strong>' + escapeHtml(formatMoney(t.amount || 0)) + '</strong></span>' +
                '<span><em>Repartidas</em><strong>' + escapeHtml(String(t.repartidas || 0)) + '</strong></span>' +
                '<span><em>Pendientes</em><strong>' + escapeHtml(String(t.pendientes || 0)) + '</strong></span>' +
              '</div>' +
            '</td>' +
          '</tr>' +
          '<tr class="report-row-reparto">' +
            '<th scope="row">Repartición</th>' +
            reportSplitCells(parts, splits) +
          '</tr>' +
        '</tbody>' +
      '</table>';

    var sales = report.sales || [];
    if (!sales.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML =
      '<table class="report-table report-table--sales">' +
        '<thead>' +
          '<tr>' +
            '<th>Fecha</th><th>Cliente</th><th>Total</th><th>Estado</th><th></th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' +
          sales.map(function (o) {
            var splitParts = (o.split && o.split.parts) || {};
            var actions = o.repartida
              ? '<button type="button" class="btn btn-outline btn-sm" data-repartida-order="' + escapeHtml(o.id) + '" data-repartida="0">Quitar</button>'
              : '<button type="button" class="btn btn-primary btn-sm" data-repartida-order="' + escapeHtml(o.id) + '" data-repartida="1">Marcar repartida</button>';
            return '<tr class="report-row-ventas">' +
              '<td>' + escapeHtml(String(o.confirmedAt || '').slice(0, 16).replace('T', ' ')) + '</td>' +
              '<td>' + escapeHtml(o.customerName || 'Cliente') + '</td>' +
              '<td><strong>' + escapeHtml(formatMoney(o.totalAmount)) + '</strong></td>' +
              '<td>' + orderStatusBadge('venta', o.repartida) + '</td>' +
              '<td class="report-actions">' + actions + '</td>' +
            '</tr>' +
            '<tr class="report-row-reparto">' +
              '<th scope="row">Repartición</th>' +
              '<td colspan="4">' +
                '<div class="report-split-inline">' +
                  Object.keys(SPLIT_LABELS).map(function (k) {
                    return '<span><em>' + escapeHtml(SPLIT_LABELS[k]) + '</em><strong>' +
                      escapeHtml(formatMoney(splitParts[k] || 0)) + '</strong></span>';
                  }).join('') +
                  '<span><em>Resto</em><strong>' + escapeHtml(formatMoney(splitParts.resto || 0)) + '</strong></span>' +
                '</div>' +
              '</td>' +
            '</tr>';
          }).join('') +
        '</tbody>' +
      '</table>';
    bindRepartidaButtons(list);
  }

  function loadPeriodReport(silent) {
    initReportDates();
    var from = document.getElementById('reportFrom').value;
    var to = document.getElementById('reportTo').value || localDayKey(new Date());
    return invApi('report.period', { from: from, to: to })
      .then(function (res) {
        state.report = res.report || null;
        renderPeriodReport();
      })
      .catch(function (err) {
        if (!silent) alert(err.message || 'No se pudo calcular el reparto');
      });
  }

  function orderLineRowsHtml(lines) {
    var rows = (lines && lines.length) ? lines : [{ productId: '', qty: 1, unitPrice: '' }];
    return rows.map(function (line, idx) {
      var opts = '<option value="">— Producto —</option>' +
        (state.products || []).map(function (p) {
          var sel = line.productId === p.id ? ' selected' : '';
          return '<option value="' + escapeHtml(p.id) + '"' + sel + '>' + escapeHtml(p.name) +
            ' (stock ' + escapeHtml(String(p.stockQty)) + ' · venta ' + formatMoney(p.salePrice) + ')</option>';
        }).join('');
      return '<div class="purchase-line-row" data-order-line="' + idx + '">' +
        '<div class="field" style="margin:0"><label>Producto</label><select data-ol-product>' + opts + '</select></div>' +
        '<div class="field" style="margin:0"><label>Cantidad</label><input type="number" min="0.01" step="0.01" data-ol-qty value="' +
          escapeHtml(String(line.qty != null ? line.qty : 1)) + '"></div>' +
        '<div class="field" style="margin:0"><label>Precio unit.</label><input type="number" min="0" step="0.01" data-ol-price value="' +
          escapeHtml(String(line.unitPrice != null && line.unitPrice !== '' ? line.unitPrice : '')) +
          '" placeholder="auto"></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-ol-remove title="Quitar">✕</button>' +
      '</div>';
    }).join('');
  }

  function openOrderModal() {
    state.editing = null;
    state.modalKind = 'order';
    state.pendingPhoto = null;
    if (!state.products.length) {
      alert('Primero creá al menos un producto.');
      return;
    }
    if (modalTitle) modalTitle.textContent = 'Nueva orden (pedido)';
    if (modalDelete) modalDelete.hidden = true;
    if (modalBody) {
      modalBody.innerHTML =
        '<div class="flags-row">' +
          '<label class="check-inline"><input type="checkbox" id="oWithInvoice"> Con factura</label>' +
          '<label class="check-inline"><input type="checkbox" id="oContraPedido"> Contra pedido (no exige stock)</label>' +
        '</div>' +
        '<div class="splits-grid">' +
          '<div class="field"><label>Cliente</label><input id="oCustomerName" placeholder="Nombre"></div>' +
          '<div class="field"><label>Cédula / ID</label><input id="oCustomerId" placeholder="Opcional"></div>' +
          '<div class="field"><label>Teléfono</label><input id="oCustomerPhone" placeholder="Opcional"></div>' +
          '<div class="field"><label>Correo</label><input id="oCustomerEmail" type="email" placeholder="Opcional"></div>' +
        '</div>' +
        '<div class="field"><label>Dirección</label><input id="oCustomerAddress" placeholder="Opcional"></div>' +
        '<div class="field"><label>Notas</label><input id="oNotes" placeholder="Detalle del pedido"></div>' +
        '<div class="field"><label>Productos</label>' +
          '<div id="orderLines">' + orderLineRowsHtml([{ productId: '', qty: 1, unitPrice: '' }]) + '</div>' +
          '<button type="button" class="btn btn-outline btn-sm" id="btnAddOrderLine">+ Línea</button>' +
        '</div>' +
        '<p class="panel-hint">Queda como <strong>orden</strong>. Cuando paguen/concreten, usá “Declarar venta”. Si no es contra pedido, reserva stock ya.</p>';
    }
    bindOrderModalEvents();
    if (modalBackdrop) modalBackdrop.classList.add('open');
  }

  function bindOrderModalEvents() {
    var wrap = document.getElementById('orderLines');
    var btnAdd = document.getElementById('btnAddOrderLine');
    if (btnAdd && wrap) {
      btnAdd.onclick = function () {
        wrap.insertAdjacentHTML('beforeend', orderLineRowsHtml([{ productId: '', qty: 1, unitPrice: '' }]));
        bindOrderLineRemoves();
        bindOrderProductAutofill();
      };
    }
    bindOrderLineRemoves();
    bindOrderProductAutofill();
  }

  function bindOrderLineRemoves() {
    var wrap = document.getElementById('orderLines');
    if (!wrap) return;
    wrap.querySelectorAll('[data-ol-remove]').forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest('[data-order-line]');
        if (row) row.remove();
      };
    });
  }

  function bindOrderProductAutofill() {
    var wrap = document.getElementById('orderLines');
    if (!wrap) return;
    wrap.querySelectorAll('[data-ol-product]').forEach(function (sel) {
      sel.onchange = function () {
        var row = sel.closest('[data-order-line]');
        if (!row) return;
        var priceEl = row.querySelector('[data-ol-price]');
        if (!priceEl || priceEl.value) return;
        var p = (state.products || []).find(function (x) { return x.id === sel.value; });
        if (p) {
          priceEl.value = p.effectivePrice != null
            ? p.effectivePrice
            : (p.salePrice != null ? p.salePrice : 0);
        }
      };
    });
  }

  function readOrderLinesFromDom() {
    var wrap = document.getElementById('orderLines');
    if (!wrap) return [];
    var out = [];
    wrap.querySelectorAll('[data-order-line]').forEach(function (row) {
      var productId = (row.querySelector('[data-ol-product]') || {}).value || '';
      var qty = Number((row.querySelector('[data-ol-qty]') || {}).value) || 0;
      var priceRaw = (row.querySelector('[data-ol-price]') || {}).value;
      var item = { productId: productId, qty: qty };
      if (priceRaw !== '' && priceRaw != null) item.unitPrice = Number(priceRaw) || 0;
      if (!productId || !(qty > 0)) return;
      out.push(item);
    });
    return out;
  }

  function saveOrderModal() {
    var items = readOrderLinesFromDom();
    if (!items.length) {
      alert('Agregá al menos un producto con cantidad');
      return;
    }
    if (modalSave) modalSave.disabled = true;
    invApi('orders.create', {
      withInvoice: !!(document.getElementById('oWithInvoice') && document.getElementById('oWithInvoice').checked),
      contraPedido: !!(document.getElementById('oContraPedido') && document.getElementById('oContraPedido').checked),
      customerName: (document.getElementById('oCustomerName') || {}).value || '',
      customerIdNumber: (document.getElementById('oCustomerId') || {}).value || '',
      customerPhone: (document.getElementById('oCustomerPhone') || {}).value || '',
      customerEmail: (document.getElementById('oCustomerEmail') || {}).value || '',
      customerAddress: (document.getElementById('oCustomerAddress') || {}).value || '',
      notes: (document.getElementById('oNotes') || {}).value || '',
      items: items
    })
      .then(function (res) {
        if (res.products) state.products = res.products;
        closeModal();
        return loadBootstrap();
      })
      .catch(function (err) {
        alert(err.message || 'No se pudo crear la orden');
      })
      .finally(function () {
        if (modalSave) modalSave.disabled = false;
      });
  }

  function renderPurchases() {
    var list = document.getElementById('purchasesList');
    var empty = document.getElementById('purchasesEmpty');
    if (!list) return;
    var rows = state.purchases || [];
    if (!rows.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = rows.map(function (pc) {
      var cancelled = pc.status === 'cancelled';
      var title = pc.supplierName || 'Compra sin proveedor';
      var items = (pc.items || []).map(function (it) {
        return '<li>' + escapeHtml(it.productName) + ' × ' + escapeHtml(String(it.qty)) +
          (it.unitCost > 0 ? ' · costo ' + formatMoney(it.unitCost) : '') + '</li>';
      }).join('');
      return '<article class="purchase-card' + (cancelled ? ' is-cancelled' : '') + '">' +
        '<div class="purchase-card__head">' +
          '<div>' +
            '<h3>' + escapeHtml(title) + '</h3>' +
            '<p class="panel-hint" style="margin:4px 0 0">' +
              escapeHtml(pc.createdByUsername || '—') +
              (pc.createdAt ? ' · ' + escapeHtml(String(pc.createdAt).slice(0, 16).replace('T', ' ')) : '') +
              (pc.notes ? ' · ' + escapeHtml(pc.notes) : '') +
            '</p>' +
          '</div>' +
          '<div>' +
            '<span class="badge-status ' + (cancelled ? 'badge-overdue' : 'badge-paid') + '">' +
              (cancelled ? 'Cancelada' : 'Confirmada') +
            '</span>' +
            (!cancelled
              ? ' <button type="button" class="btn btn-outline btn-sm" data-cancel-purchase="' + escapeHtml(pc.id) + '">Cancelar</button>'
              : '') +
          '</div>' +
        '</div>' +
        '<ul class="purchase-card__items">' + items + '</ul>' +
        (cancelled && pc.cancelledByUsername
          ? '<p class="panel-hint">Canceló: ' + escapeHtml(pc.cancelledByUsername) + '</p>'
          : '') +
      '</article>';
    }).join('');
    list.querySelectorAll('[data-cancel-purchase]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-cancel-purchase');
        if (!confirm('¿Cancelar esta compra? El stock baja de nuevo.')) return;
        invApi('purchases.cancel', { id: id })
          .then(function (res) {
            if (res.products) state.products = res.products;
            return loadBootstrap();
          })
          .catch(function (err) {
            alert(err.message || 'No se pudo cancelar');
          });
      });
    });
  }

  function purchaseLineRowsHtml(lines) {
    var rows = (lines && lines.length) ? lines : [{ productId: '', qty: 1, unitCost: 0 }];
    var opts = '<option value="">— Producto —</option>' +
      (state.products || []).map(function (p) {
        return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) +
          ' (stock ' + escapeHtml(String(p.stockQty)) + ')</option>';
      }).join('');
    return rows.map(function (line, idx) {
      return '<div class="purchase-line-row" data-purchase-line="' + idx + '">' +
        '<div class="field" style="margin:0"><label>Producto</label><select data-pl-product>' + opts + '</select></div>' +
        '<div class="field" style="margin:0"><label>Cantidad</label><input type="number" min="0.01" step="0.01" data-pl-qty value="' +
          escapeHtml(String(line.qty != null ? line.qty : 1)) + '"></div>' +
        '<div class="field" style="margin:0"><label>Costo unit. (opc.)</label><input type="number" min="0" step="0.01" data-pl-cost value="' +
          escapeHtml(String(line.unitCost != null ? line.unitCost : 0)) + '"></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-pl-remove title="Quitar">✕</button>' +
      '</div>';
    }).join('');
  }

  function openPurchaseModal() {
    state.editing = null;
    state.modalKind = 'purchase';
    state.pendingPhoto = null;
    if (!state.products.length) {
      alert('Primero creá al menos un producto.');
      return;
    }
    if (modalTitle) modalTitle.textContent = 'Nueva compra (entra stock)';
    if (modalDelete) modalDelete.hidden = true;
    if (modalBody) {
      modalBody.innerHTML =
        '<div class="field"><label>Proveedor (opcional)</label><input id="pcSupplier" placeholder="Nombre o nota corta"></div>' +
        '<div class="field"><label>Notas</label><input id="pcNotes" placeholder="Factura, lote, etc."></div>' +
        '<div class="field"><label>Productos</label>' +
          '<div id="purchaseLines">' + purchaseLineRowsHtml([{ productId: '', qty: 1, unitCost: 0 }]) + '</div>' +
          '<button type="button" class="btn btn-outline btn-sm" id="btnAddPurchaseLine">+ Línea</button>' +
        '</div>' +
        '<p class="panel-hint">Si ponés costo unitario, actualiza el precio de costo del producto.</p>';
    }
    bindPurchaseModalEvents();
    if (modalBackdrop) modalBackdrop.classList.add('open');
  }

  function bindPurchaseModalEvents() {
    var wrap = document.getElementById('purchaseLines');
    var btnAdd = document.getElementById('btnAddPurchaseLine');
    if (btnAdd && wrap) {
      btnAdd.onclick = function () {
        wrap.insertAdjacentHTML('beforeend', purchaseLineRowsHtml([{ productId: '', qty: 1, unitCost: 0 }]));
        bindPurchaseLineRemoves();
      };
    }
    bindPurchaseLineRemoves();
  }

  function bindPurchaseLineRemoves() {
    var wrap = document.getElementById('purchaseLines');
    if (!wrap) return;
    wrap.querySelectorAll('[data-pl-remove]').forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest('[data-purchase-line]');
        if (row) row.remove();
      };
    });
  }

  function readPurchaseLinesFromDom() {
    var wrap = document.getElementById('purchaseLines');
    if (!wrap) return [];
    var out = [];
    wrap.querySelectorAll('[data-purchase-line]').forEach(function (row) {
      var productId = (row.querySelector('[data-pl-product]') || {}).value || '';
      var qty = Number((row.querySelector('[data-pl-qty]') || {}).value) || 0;
      var unitCost = Number((row.querySelector('[data-pl-cost]') || {}).value) || 0;
      if (!productId || !(qty > 0)) return;
      out.push({ productId: productId, qty: qty, unitCost: unitCost });
    });
    return out;
  }

  function savePurchaseModal() {
    var items = readPurchaseLinesFromDom();
    if (!items.length) {
      alert('Agregá al menos un producto con cantidad');
      return;
    }
    if (modalSave) modalSave.disabled = true;
    invApi('purchases.create', {
      supplierName: (document.getElementById('pcSupplier') || {}).value || '',
      notes: (document.getElementById('pcNotes') || {}).value || '',
      items: items
    })
      .then(function (res) {
        if (res.products) state.products = res.products;
        closeModal();
        return loadBootstrap();
      })
      .catch(function (err) {
        alert(err.message || 'No se pudo guardar la compra');
      })
      .finally(function () {
        if (modalSave) modalSave.disabled = false;
      });
  }

  function renderProducts() {
    var grid = document.getElementById('productsGrid');
    var empty = document.getElementById('productsEmpty');
    if (!grid) return;
    var list = state.products || [];
    if (!list.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    grid.innerHTML = list.map(function (p) {
      var photo = p.hasPhoto
        ? '<img src="' + escapeHtml(photoUrl(p.id)) + '" alt="" />'
        : 'Sin foto';
      var commissions = (p.commissions || []).length
        ? (p.commissions.length + ' comisión(es)')
        : 'Sin comisiones';
      return '<article class="product-card">' +
        '<div class="product-card__photo">' + photo + '</div>' +
        '<div class="product-card__body">' +
          '<h3>' + escapeHtml(p.name) + '</h3>' +
          '<p class="product-card__meta">Stock: <strong>' + escapeHtml(String(p.stockQty)) + '</strong></p>' +
          '<p class="product-card__meta">Costo: ' + formatMoney(p.costPrice) +
            ' · Mín: ' + formatMoney(p.minPrice || 0) + '</p>' +
          '<p class="product-card__meta">Venta: ' + formatMoney(p.salePrice) +
            ' · Margen: ' + escapeHtml(String(p.marginPercent || 0)) + '%' +
            (p.discountPercent ? ' · Desc: ' + escapeHtml(String(p.discountPercent)) + '%' : '') +
            '</p>' +
          '<p class="product-card__meta">Final: <strong>' + formatMoney(p.effectivePrice != null ? p.effectivePrice : p.salePrice) +
            '</strong> · ' + escapeHtml(commissions) + '</p>' +
          '<p class="product-card__audit">Editó: ' + escapeHtml(p.updatedByUsername || '—') +
            (p.updatedAt ? ' · ' + escapeHtml(String(p.updatedAt).slice(0, 10)) : '') + '</p>' +
          '<div class="product-card__actions">' +
            '<button type="button" class="btn btn-outline btn-sm" data-edit-product="' + escapeHtml(p.id) + '">Editar</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
    grid.querySelectorAll('[data-edit-product]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = state.products.find(function (x) { return x.id === btn.getAttribute('data-edit-product'); });
        if (p) openProductModal(p);
      });
    });
  }

  function commissionRowsHtml(list) {
    var rows = (list && list.length) ? list : [{ id: 'c_1', name: '', mode: 'percent', value: 0 }];
    return rows.map(function (c, idx) {
      return '<div class="commission-row" data-comm-row="' + idx + '">' +
        '<div class="field" style="margin:0"><label>Nombre</label><input data-c-name value="' + escapeHtml(c.name || '') + '"></div>' +
        '<div class="field" style="margin:0"><label>Modo</label><select data-c-mode>' +
          '<option value="percent"' + (c.mode !== 'fixed' ? ' selected' : '') + '>%</option>' +
          '<option value="fixed"' + (c.mode === 'fixed' ? ' selected' : '') + '>Monto</option>' +
        '</select></div>' +
        '<div class="field" style="margin:0"><label>Valor</label><input type="number" min="0" step="0.01" data-c-value value="' + escapeHtml(String(c.value != null ? c.value : 0)) + '"></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-c-remove title="Quitar">✕</button>' +
      '</div>';
    }).join('');
  }

  function currentSplits() {
    return (state.settings && state.settings.splits) || {
      impuestos: 13, exhatech: 2.5, vendedor: 10, comision_bancaria: 0
    };
  }

  function sumSplitsPct(splits) {
    var s = splits || currentSplits();
    return Object.keys(SPLIT_LABELS).reduce(function (acc, k) {
      return acc + (Number(s[k]) || 0);
    }, 0);
  }

  function calcMinPrice(cost) {
    return Math.round((Number(cost) || 0) * (1 + sumSplitsPct() / 100) * 100) / 100;
  }

  function calcSaleFromMargin(minPrice, marginPct) {
    return Math.round((Number(minPrice) || 0) * (1 + (Number(marginPct) || 0) / 100) * 100) / 100;
  }

  function calcMarginFromSale(minPrice, sale) {
    var min = Number(minPrice) || 0;
    var s = Number(sale) || 0;
    if (!(min > 0)) return s > 0 ? 100 : 0;
    return Math.round((((s / min) - 1) * 100) * 1000) / 1000;
  }

  function calcMaxDiscountPct(sale, minPrice) {
    var s = Number(sale) || 0;
    if (!(s > 0)) return 0;
    var marginMoney = Math.max(0, s - (Number(minPrice) || 0));
    return Math.min(100, Math.round(((marginMoney / 2) / s) * 100 * 1000) / 1000);
  }

  function syncProductPricingUi(source) {
    var costEl = document.getElementById('pCost');
    var marginEl = document.getElementById('pMargin');
    var saleEl = document.getElementById('pSale');
    var discEl = document.getElementById('pDiscount');
    var minEl = document.getElementById('pMinHint');
    var maxDiscEl = document.getElementById('pMaxDiscHint');
    if (!costEl || !marginEl || !saleEl) return;
    var cost = Number(costEl.value) || 0;
    var minPrice = calcMinPrice(cost);
    if (minEl) {
      minEl.textContent = 'Mínimo (costo + % globales): ' + formatMoney(minPrice);
    }
    if (source === 'margin') {
      saleEl.value = calcSaleFromMargin(minPrice, marginEl.value);
    } else if (source === 'price' || source === 'cost') {
      if (source === 'cost' && (Number(saleEl.value) || 0) < minPrice) {
        saleEl.value = minPrice;
      }
      marginEl.value = calcMarginFromSale(minPrice, saleEl.value);
    }
    var sale = Number(saleEl.value) || 0;
    var maxDisc = calcMaxDiscountPct(sale, minPrice);
    if (maxDiscEl) {
      maxDiscEl.textContent = 'Descuento máx (½ del margen): ' + maxDisc + '%';
    }
    if (discEl && (Number(discEl.value) || 0) > maxDisc) {
      discEl.value = maxDisc;
    }
    var effEl = document.getElementById('pEffHint');
    if (effEl) {
      var d = Number(discEl && discEl.value) || 0;
      var eff = Math.round(sale * (1 - d / 100) * 100) / 100;
      effEl.textContent = 'Precio final con descuento: ' + formatMoney(eff);
    }
  }

  function openProductModal(product) {
    state.editing = product || null;
    state.modalKind = 'product';
    state.pendingPhoto = null;
    var p = product || {
      name: '',
      description: '',
      stockQty: 0,
      costPrice: 0,
      salePrice: 0,
      marginPercent: 0,
      discountPercent: 0,
      commissions: [],
      hasPhoto: false
    };
    if (modalTitle) modalTitle.textContent = product ? 'Editar producto' : 'Nuevo producto';
    if (modalDelete) modalDelete.hidden = !product;
    if (modalBody) {
      modalBody.innerHTML =
        '<div class="field"><label>Nombre *</label><input id="pName" value="' + escapeHtml(p.name || '') + '"></div>' +
        '<div class="field"><label>Descripción</label><textarea id="pDesc">' + escapeHtml(p.description || '') + '</textarea></div>' +
        '<div class="field"><label>Stock</label><input type="number" min="0" step="0.01" id="pStock" value="' + escapeHtml(String(p.stockQty || 0)) + '"></div>' +
        '<div class="splits-grid">' +
          '<div class="field"><label>Precio costo</label><input type="number" min="0" step="0.01" id="pCost" value="' + escapeHtml(String(p.costPrice || 0)) + '"></div>' +
          '<div class="field"><label>Margen %</label><input type="number" min="0" step="0.01" id="pMargin" value="' + escapeHtml(String(p.marginPercent || 0)) + '"></div>' +
          '<div class="field"><label>Precio venta</label><input type="number" min="0" step="0.01" id="pSale" value="' + escapeHtml(String(p.salePrice || 0)) + '"></div>' +
          '<div class="field"><label>Descuento %</label><input type="number" min="0" max="100" step="0.01" id="pDiscount" value="' + escapeHtml(String(p.discountPercent || 0)) + '"></div>' +
        '</div>' +
        '<p class="panel-hint" id="pMinHint"></p>' +
        '<p class="panel-hint" id="pMaxDiscHint"></p>' +
        '<p class="panel-hint" id="pEffHint"></p>' +
        '<p class="panel-hint">Si cambiás el margen, se recalcula el precio (y viceversa). El descuento no puede pasar de la mitad del margen.</p>' +
        '<div class="field"><label>Foto</label><input type="file" id="pPhoto" accept="image/jpeg,image/png,image/webp,image/gif">' +
          (p.hasPhoto && p.id
            ? '<img class="photo-preview" id="pPhotoPreview" src="' + escapeHtml(photoUrl(p.id)) + '" alt="">'
            : '<img class="photo-preview" id="pPhotoPreview" hidden alt="">') +
        '</div>' +
        '<div class="field"><label>Comisiones de venta</label>' +
          '<div class="commission-list" id="commissionList">' + commissionRowsHtml(p.commissions) + '</div>' +
          '<button type="button" class="btn btn-outline btn-sm" id="btnAddCommission">+ Comisión</button>' +
        '</div>' +
        (product
          ? '<p class="panel-hint">Creó: ' + escapeHtml(p.createdByUsername || '—') +
            ' · Última edición: ' + escapeHtml(p.updatedByUsername || '—') + '</p>'
          : '');
    }
    bindProductModalEvents();
    syncProductPricingUi('cost');
    if (modalBackdrop) modalBackdrop.classList.add('open');
  }

  function bindProductModalEvents() {
    var list = document.getElementById('commissionList');
    var btnAdd = document.getElementById('btnAddCommission');
    if (btnAdd && list) {
      btnAdd.addEventListener('click', function () {
        list.insertAdjacentHTML('beforeend', commissionRowsHtml([{ name: '', mode: 'percent', value: 0 }]));
        bindCommissionRemoves();
      });
    }
    bindCommissionRemoves();
    var costEl = document.getElementById('pCost');
    var marginEl = document.getElementById('pMargin');
    var saleEl = document.getElementById('pSale');
    var discEl = document.getElementById('pDiscount');
    if (costEl) costEl.addEventListener('input', function () { syncProductPricingUi('cost'); });
    if (marginEl) marginEl.addEventListener('input', function () { syncProductPricingUi('margin'); });
    if (saleEl) saleEl.addEventListener('input', function () { syncProductPricingUi('price'); });
    if (discEl) discEl.addEventListener('input', function () { syncProductPricingUi('discount'); });
    var photoInput = document.getElementById('pPhoto');
    if (photoInput) {
      photoInput.addEventListener('change', function () {
        var file = photoInput.files && photoInput.files[0];
        if (!file) {
          state.pendingPhoto = null;
          return;
        }
        if (file.size > 2.5 * 1024 * 1024) {
          alert('Foto máxima 2.5 MB');
          photoInput.value = '';
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          state.pendingPhoto = {
            contentType: file.type || 'image/jpeg',
            dataBase64: String(reader.result || '')
          };
          var preview = document.getElementById('pPhotoPreview');
          if (preview) {
            preview.src = state.pendingPhoto.dataBase64;
            preview.hidden = false;
          }
        };
        reader.readAsDataURL(file);
      });
    }
  }

  function bindCommissionRemoves() {
    var list = document.getElementById('commissionList');
    if (!list) return;
    list.querySelectorAll('[data-c-remove]').forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest('[data-comm-row]');
        if (row) row.remove();
      };
    });
  }

  function readCommissionsFromDom() {
    var list = document.getElementById('commissionList');
    if (!list) return [];
    var out = [];
    list.querySelectorAll('[data-comm-row]').forEach(function (row, idx) {
      var name = (row.querySelector('[data-c-name]') || {}).value || '';
      name = String(name).trim();
      if (!name) return;
      var mode = (row.querySelector('[data-c-mode]') || {}).value || 'percent';
      var value = Number((row.querySelector('[data-c-value]') || {}).value) || 0;
      out.push({ id: 'c_' + (idx + 1), name: name, mode: mode, value: value });
    });
    return out;
  }

  function closeModal() {
    state.editing = null;
    state.modalKind = null;
    state.pendingPhoto = null;
    if (modalBackdrop) modalBackdrop.classList.remove('open');
  }

  function saveProductModal() {
    var name = (document.getElementById('pName') || {}).value || '';
    name = String(name).trim();
    if (!name) {
      alert('Nombre obligatorio');
      return;
    }
    var payload = {
      id: state.editing ? state.editing.id : undefined,
      name: name,
      description: (document.getElementById('pDesc') || {}).value || '',
      stockQty: Number((document.getElementById('pStock') || {}).value) || 0,
      costPrice: Number((document.getElementById('pCost') || {}).value) || 0,
      salePrice: Number((document.getElementById('pSale') || {}).value) || 0,
      marginPercent: Number((document.getElementById('pMargin') || {}).value) || 0,
      discountPercent: Number((document.getElementById('pDiscount') || {}).value) || 0,
      priceMode: 'price',
      commissions: readCommissionsFromDom()
    };
    if (modalSave) modalSave.disabled = true;
    invApi('products.save', payload)
      .then(function (res) {
        var product = res.product;
        if (state.pendingPhoto && product && product.id) {
          return invApi('products.photo.upload', {
            id: product.id,
            contentType: state.pendingPhoto.contentType,
            dataBase64: state.pendingPhoto.dataBase64
          }).then(function () { return product; });
        }
        return product;
      })
      .then(function () {
        closeModal();
        return loadBootstrap();
      })
      .catch(function (err) {
        alert(err.message || 'No se pudo guardar');
      })
      .finally(function () {
        if (modalSave) modalSave.disabled = false;
      });
  }

  function deleteProductModal() {
    if (!state.editing || !state.editing.id) return;
    if (!confirm('¿Desactivar este producto? La foto se borra.')) return;
    invApi('products.delete', { id: state.editing.id })
      .then(function () {
        closeModal();
        return loadBootstrap();
      })
      .catch(function (err) {
        alert(err.message || 'No se pudo desactivar');
      });
  }

  function loadBootstrap() {
    return invApi('bootstrap', { includeInactive: false })
      .then(function (res) {
        state.settings = res.settings || null;
        state.products = res.products || [];
        state.purchases = res.purchases || [];
        state.orders = res.orders || [];
        fillSplitsForm();
        renderProducts();
        renderPurchases();
        renderOrders();
        showApiError('');
      });
  }

  function showShell(user) {
    state.user = user;
    if (boot) boot.hidden = true;
    if (shell) shell.hidden = false;
    var label = document.getElementById('userLabel');
    if (label) label.textContent = user.displayName || user.username;
    authApi('track.module', { module: 'inventario' }).catch(function () {});
    loadBootstrap().catch(function (err) {
      showApiError(err.message || 'No se pudo cargar inventario');
    });
  }

  document.querySelectorAll('.inv-nav [data-panel]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchPanel(btn.getAttribute('data-panel'));
    });
  });

  var btnNew = document.getElementById('btnNewProduct');
  if (btnNew) btnNew.addEventListener('click', function () { openProductModal(null); });
  var btnNewPurchase = document.getElementById('btnNewPurchase');
  if (btnNewPurchase) btnNewPurchase.addEventListener('click', openPurchaseModal);
  var btnNewOrder = document.getElementById('btnNewOrder');
  if (btnNewOrder) btnNewOrder.addEventListener('click', openOrderModal);

  var splitsForm = document.getElementById('splitsForm');
  if (splitsForm) {
    splitsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      invApi('settings.save', { splits: readSplitsForm() })
        .then(function (res) {
          state.settings = res.settings;
          fillSplitsForm();
          return loadBootstrap();
        })
        .then(function () {
          alert('% globales guardados');
        })
        .catch(function (err) {
          alert(err.message || 'No se pudo guardar');
        });
    });
  }

  var btnLoadReport = document.getElementById('btnLoadReport');
  if (btnLoadReport) {
    btnLoadReport.addEventListener('click', function () {
      loadPeriodReport(false);
    });
  }
  initReportDates();

  if (modalSave) {
    modalSave.addEventListener('click', function () {
      if (state.modalKind === 'purchase') savePurchaseModal();
      else if (state.modalKind === 'order') saveOrderModal();
      else saveProductModal();
    });
  }
  if (modalCancel) modalCancel.addEventListener('click', closeModal);
  if (modalDelete) modalDelete.addEventListener('click', deleteProductModal);
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', function (e) {
      if (e.target === modalBackdrop) closeModal();
    });
  }

  var btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', function () {
      authApi('logout').catch(function () {}).finally(rejectUnauthorized);
    });
  }

  if (!getToken()) {
    rejectUnauthorized();
    return;
  }

  authApi('me')
    .then(function (res) {
      var user = res.user;
      if (!user) {
        rejectUnauthorized();
        return;
      }
      if (user.role === 'admin') {
        goHub();
        return;
      }
      if (!(user.modules && user.modules.inventario)) {
        goHub();
        return;
      }
      setSession(getToken(), user);
      showShell(user);
    })
    .catch(function () {
      rejectUnauthorized();
    });
})();
