/**
 * Yurguen: modelo Inventario (compartido Mayoreo Kenneth).
 * Globales obligatorios sobre el costo → precio mínimo.
 * En producto: margen ↔ precio y descuento (≤ mitad del margen).
 */
const crypto = require('crypto');

/** Globales de carga/reparto (ganancia y costo viven en el producto). */
const SPLIT_KEYS = ['impuestos', 'exhatech', 'vendedor', 'comision_bancaria'];

const SPLIT_DEFAULTS = {
  impuestos: 13,
  exhatech: 2.5,
  vendedor: 10,
  comision_bancaria: 0,
};

function uid(prefix) {
  return String(prefix || 'p') + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
}

function roundMoney(v) {
  return Math.round(toNum(v, 0) * 100) / 100;
}

function clampPct(v) {
  const n = toNum(v, 0);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 1000) / 1000;
}

/** Margen puede ser > 100%. */
function clampNonNeg(v) {
  const n = toNum(v, 0);
  return n < 0 ? 0 : Math.round(n * 1000) / 1000;
}

function sumSplitPct(splits) {
  const s = normalizeSplits(splits);
  return SPLIT_KEYS.reduce((acc, k) => acc + toNum(s[k], 0), 0);
}

/** Precio mínimo = costo × (1 + suma% globales / 100). */
function computeMinPrice(costPrice, splits) {
  const cost = Math.max(0, toNum(costPrice, 0));
  return roundMoney(cost * (1 + sumSplitPct(splits) / 100));
}

function computeSaleFromMargin(minPrice, marginPercent) {
  return roundMoney(Math.max(0, toNum(minPrice, 0)) * (1 + clampNonNeg(marginPercent) / 100));
}

function computeMarginFromSale(minPrice, salePrice) {
  const min = Math.max(0, toNum(minPrice, 0));
  const sale = Math.max(0, toNum(salePrice, 0));
  if (!(min > 0)) return sale > 0 ? 100 : 0;
  return clampNonNeg(((sale / min) - 1) * 100);
}

function marginMoney(salePrice, minPrice) {
  return Math.max(0, toNum(salePrice, 0) - toNum(minPrice, 0));
}

/** Descuento máx. = mitad del margen, expresado como % del precio de venta. */
function maxDiscountPercent(salePrice, minPrice) {
  const sale = Math.max(0, toNum(salePrice, 0));
  if (!(sale > 0)) return 0;
  const maxDiscMoney = marginMoney(sale, minPrice) / 2;
  return clampPct((maxDiscMoney / sale) * 100);
}

function effectivePrice(salePrice, discountPercent) {
  const sale = Math.max(0, toNum(salePrice, 0));
  const d = clampPct(discountPercent);
  return roundMoney(sale * (1 - d / 100));
}

function enrichProductPricing(product, splits) {
  if (!product) return null;
  const minPrice = computeMinPrice(product.costPrice, splits);
  const salePrice = Math.max(toNum(product.salePrice, 0), 0);
  const marginPercent = product.marginPercent != null
    ? clampNonNeg(product.marginPercent)
    : computeMarginFromSale(minPrice, salePrice);
  const discountPercent = clampPct(product.discountPercent);
  return {
    ...product,
    splitOverride: null,
    minPrice,
    marginPercent,
    discountPercent,
    marginMoney: marginMoney(salePrice, minPrice),
    maxDiscountPercent: maxDiscountPercent(salePrice, minPrice),
    effectivePrice: effectivePrice(salePrice, discountPercent),
    belowMin: salePrice + 1e-9 < minPrice,
  };
}

function emptySplits() {
  return {
    impuestos: SPLIT_DEFAULTS.impuestos,
    exhatech: SPLIT_DEFAULTS.exhatech,
    vendedor: SPLIT_DEFAULTS.vendedor,
    comision_bancaria: SPLIT_DEFAULTS.comision_bancaria,
  };
}

function normalizeSplits(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  // Compat: nombres viejos → nuevos
  const mapped = {
    impuestos: src.impuestos,
    exhatech: src.exhatech != null ? src.exhatech : src.pagina_web,
    vendedor: src.vendedor != null ? src.vendedor : src.venta,
    comision_bancaria: src.comision_bancaria,
  };
  const out = emptySplits();
  SPLIT_KEYS.forEach((k) => {
    if (mapped[k] == null || mapped[k] === '') {
      out[k] = SPLIT_DEFAULTS[k];
    } else {
      out[k] = clampPct(mapped[k]);
    }
  });
  return out;
}

function normalizeCommission(raw, idx) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const mode = c.mode === 'fixed' ? 'fixed' : 'percent';
  const value = mode === 'percent' ? clampPct(c.value) : Math.max(0, toNum(c.value, 0));
  return {
    id: String(c.id || ('c_' + (idx + 1))),
    name: String(c.name || '').trim() || ('Comisión ' + (idx + 1)),
    mode,
    value,
  };
}

function normalizeCommissions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 20)
    .map((c, i) => normalizeCommission(c, i))
    .filter((c) => c.name);
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function actorFromUser(user) {
  return {
    userId: String((user && user.id) || ''),
    username: String((user && (user.displayName || user.username)) || 'usuario'),
  };
}

function defaultSettings() {
  return {
    splits: emptySplits(),
    updatedAt: null,
    updatedByUserId: null,
    updatedByUsername: null,
  };
}

function normalizeSettings(row) {
  if (!row) return defaultSettings();
  if (row.splits) {
    return {
      splits: normalizeSplits(row.splits),
      updatedAt: row.updatedAt || row.updated_at || null,
      updatedByUserId: row.updatedByUserId || row.updated_by_user_id || null,
      updatedByUsername: row.updatedByUsername || row.updated_by_username || null,
    };
  }
  return {
    splits: normalizeSplits({
      impuestos: row.split_impuestos ?? row.splitImpuestos,
      exhatech: row.split_exhatech ?? row.splitExhatech ?? row.split_pagina_web ?? row.splitPaginaWeb,
      vendedor: row.split_vendedor ?? row.splitVendedor ?? row.split_venta ?? row.splitVenta,
      comision_bancaria:
        row.split_comision_bancaria ?? row.splitComisionBancaria,
    }),
    updatedAt: row.updated_at || row.updatedAt || null,
    updatedByUserId: row.updated_by_user_id || row.updatedByUserId || null,
    updatedByUsername: row.updated_by_username || row.updatedByUsername || null,
  };
}

function normalizeProduct(row) {
  if (!row) return null;
  const commissions = normalizeCommissions(
    parseJson(row.commissions_json != null ? row.commissions_json : row.commissions, [])
  );
  return {
    id: String(row.id),
    name: String(row.name || '').trim(),
    description: String(row.description || ''),
    photoKey: row.photo_key || row.photoKey || null,
    photoContentType: row.photo_content_type || row.photoContentType || null,
    hasPhoto: !!(row.photo_key || row.photoKey),
    stockQty: toNum(row.stock_qty != null ? row.stock_qty : row.stockQty, 0),
    costPrice: toNum(row.cost_price != null ? row.cost_price : row.costPrice, 0),
    salePrice: toNum(row.sale_price != null ? row.sale_price : row.salePrice, 0),
    marginPercent: clampNonNeg(
      row.margin_percent != null ? row.margin_percent : row.marginPercent
    ),
    discountPercent: clampPct(
      row.discount_percent != null ? row.discount_percent : row.discountPercent
    ),
    commissions,
    // Globales no se sobreescriben por producto.
    splitOverride: null,
    active: row.active === false || Number(row.active) === 0 ? false : true,
    sortOrder: toNum(row.sort_order != null ? row.sort_order : row.sortOrder, 0),
    createdAt: row.created_at || row.createdAt || null,
    createdByUserId: row.created_by_user_id || row.createdByUserId || null,
    createdByUsername: row.created_by_username || row.createdByUsername || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    updatedByUserId: row.updated_by_user_id || row.updatedByUserId || null,
    updatedByUsername: row.updated_by_username || row.updatedByUsername || null,
  };
}

/**
 * Valida payload de alta/edición. Lanza Error con mensaje cliente.
 * @param {object} splits % globales vigentes (obligatorios sobre el costo)
 */
function buildProductInput(body, existing, user, splits) {
  const name = String((body && body.name) || '').trim();
  if (!name) throw new Error('Nombre obligatorio');
  const actor = actorFromUser(user);
  if (!actor.userId) throw new Error('Usuario inválido');
  const now = nowIso();
  const isNew = !existing;
  const commissions = normalizeCommissions(body && body.commissions);

  const costPrice = Math.max(0, toNum(body && body.costPrice, isNew ? 0 : existing.costPrice));
  const minPrice = computeMinPrice(costPrice, splits);

  let salePrice;
  let marginPercent;
  const mode = body && body.priceMode === 'margin' ? 'margin' : 'price';
  if (mode === 'margin') {
    marginPercent = clampNonNeg(
      body.marginPercent != null
        ? body.marginPercent
        : (isNew ? 0 : existing.marginPercent)
    );
    salePrice = computeSaleFromMargin(minPrice, marginPercent);
  } else {
    salePrice = Math.max(
      0,
      toNum(body && body.salePrice, isNew ? minPrice : existing.salePrice)
    );
    if (salePrice + 1e-9 < minPrice) {
      throw new Error(
        'El precio no puede ser menor al mínimo (' + minPrice.toLocaleString('es-CR') +
        '). Ese mínimo = costo + % globales.'
      );
    }
    marginPercent = computeMarginFromSale(minPrice, salePrice);
  }

  let discountPercent = clampPct(
    body && body.discountPercent != null
      ? body.discountPercent
      : (isNew ? 0 : existing.discountPercent)
  );
  const maxDisc = maxDiscountPercent(salePrice, minPrice);
  if (discountPercent > maxDisc + 0.0001) {
    throw new Error(
      'El descuento no puede superar la mitad del margen (máx ' +
      maxDisc.toLocaleString('es-CR') + '%).'
    );
  }

  return {
    id: isNew ? (String((body && body.id) || '').trim() || uid('p')) : existing.id,
    name,
    description: String((body && body.description) || '').trim(),
    stockQty: Math.max(0, toNum(body && body.stockQty, isNew ? 0 : existing.stockQty)),
    costPrice,
    salePrice,
    marginPercent,
    discountPercent,
    commissions,
    splitOverride: null,
    active: body && body.active === false ? false : true,
    sortOrder: toNum(body && body.sortOrder, isNew ? 0 : existing.sortOrder),
    photoKey: existing ? existing.photoKey : null,
    photoContentType: existing ? existing.photoContentType : null,
    createdAt: isNew ? now : existing.createdAt,
    createdByUserId: isNew ? actor.userId : existing.createdByUserId,
    createdByUsername: isNew ? actor.username : existing.createdByUsername,
    updatedAt: now,
    updatedByUserId: actor.userId,
    updatedByUsername: actor.username,
  };
}

function photoObjectKey(productId, ext) {
  const safeExt = String(ext || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  return 'inventario/photos/' + String(productId) + '.' + safeExt;
}

function extFromContentType(ct) {
  const c = String(ct || '').toLowerCase();
  if (c.includes('png')) return 'png';
  if (c.includes('webp')) return 'webp';
  if (c.includes('gif')) return 'gif';
  if (c.includes('jpeg') || c.includes('jpg')) return 'jpg';
  return 'bin';
}

function normalizePurchaseItem(raw, idx) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const qty = toNum(it.qty, 0);
  return {
    id: String(it.id || uid('pi')),
    purchaseId: it.purchaseId || it.purchase_id || null,
    productId: String(it.productId || it.product_id || ''),
    productName: String(it.productName || it.product_name || '').trim(),
    qty,
    unitCost: Math.max(0, toNum(it.unitCost != null ? it.unitCost : it.unit_cost, 0)),
    _idx: idx,
  };
}

function normalizePurchase(row) {
  if (!row) return null;
  const items = Array.isArray(row.items)
    ? row.items.map(normalizePurchaseItem).filter((x) => x.productId && x.qty > 0)
    : [];
  return {
    id: String(row.id),
    supplierName: String(row.supplierName || row.supplier_name || '').trim(),
    notes: String(row.notes || '').trim(),
    status: row.status === 'cancelled' ? 'cancelled' : 'confirmed',
    items,
    createdAt: row.createdAt || row.created_at || null,
    createdByUserId: row.createdByUserId || row.created_by_user_id || null,
    createdByUsername: row.createdByUsername || row.created_by_username || null,
    cancelledAt: row.cancelledAt || row.cancelled_at || null,
    cancelledByUserId: row.cancelledByUserId || row.cancelled_by_user_id || null,
    cancelledByUsername: row.cancelledByUsername || row.cancelled_by_username || null,
  };
}

/**
 * Arma compra confirmada a partir del body + productos existentes.
 * @param {object} body
 * @param {Array<{id:string,name:string,active?:boolean}>} products
 * @param {object} user
 */
function buildPurchaseInput(body, products, user) {
  const actor = actorFromUser(user);
  if (!actor.userId) throw new Error('Usuario inválido');
  const rawItems = Array.isArray(body && body.items) ? body.items : [];
  if (!rawItems.length) throw new Error('Agregá al menos un producto');

  const byId = new Map((products || []).map((p) => [String(p.id), p]));
  const items = [];
  rawItems.forEach((raw, idx) => {
    const productId = String((raw && (raw.productId || raw.id)) || '').trim();
    const qty = toNum(raw && raw.qty, 0);
    if (!productId || !(qty > 0)) return;
    const product = byId.get(productId);
    if (!product || product.active === false) {
      throw new Error('Producto no encontrado o inactivo');
    }
    items.push({
      id: uid('pi'),
      productId,
      productName: product.name,
      qty,
      unitCost: Math.max(0, toNum(raw.unitCost, 0)),
    });
  });
  if (!items.length) throw new Error('Agregá al menos un producto con cantidad');

  const now = nowIso();
  return {
    id: uid('pc'),
    supplierName: String((body && body.supplierName) || '').trim(),
    notes: String((body && body.notes) || '').trim(),
    status: 'confirmed',
    items,
    createdAt: now,
    createdByUserId: actor.userId,
    createdByUsername: actor.username,
    cancelledAt: null,
    cancelledByUserId: null,
    cancelledByUsername: null,
  };
}

function normalizeOrderItem(raw, idx) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const qty = toNum(it.qty, 0);
  const unitPrice = Math.max(0, toNum(it.unitPrice != null ? it.unitPrice : it.unit_price, 0));
  return {
    id: String(it.id || uid('oi')),
    orderId: it.orderId || it.order_id || null,
    productId: String(it.productId || it.product_id || ''),
    productName: String(it.productName || it.product_name || '').trim(),
    qty,
    unitPrice,
    lineTotal: Math.round(qty * unitPrice * 100) / 100,
    _idx: idx,
  };
}

function normalizeOrderStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'venta') return 'venta';
  if (s === 'cancelada' || s === 'cancelled') return 'cancelada';
  return 'orden';
}

function normalizeOrder(row) {
  if (!row) return null;
  const items = Array.isArray(row.items)
    ? row.items.map(normalizeOrderItem).filter((x) => x.productId && x.qty > 0)
    : [];
  const totalFromItems = items.reduce((acc, it) => acc + (Number(it.lineTotal) || 0), 0);
  return {
    id: String(row.id),
    status: normalizeOrderStatus(row.status),
    withInvoice: !!(row.withInvoice ?? row.with_invoice),
    contraPedido: !!(row.contraPedido ?? row.contra_pedido),
    stockReserved: !!(row.stockReserved ?? row.stock_reserved),
    repartida: !!(row.repartida ?? row.isRepartida),
    customerName: String(row.customerName || row.customer_name || '').trim(),
    customerIdNumber: String(row.customerIdNumber || row.customer_id_number || '').trim(),
    customerEmail: String(row.customerEmail || row.customer_email || '').trim(),
    customerPhone: String(row.customerPhone || row.customer_phone || '').trim(),
    customerAddress: String(row.customerAddress || row.customer_address || '').trim(),
    notes: String(row.notes || '').trim(),
    totalAmount: toNum(row.totalAmount != null ? row.totalAmount : row.total_amount, totalFromItems),
    items,
    createdAt: row.createdAt || row.created_at || null,
    createdByUserId: row.createdByUserId || row.created_by_user_id || null,
    createdByUsername: row.createdByUsername || row.created_by_username || null,
    confirmedAt: row.confirmedAt || row.confirmed_at || null,
    confirmedByUserId: row.confirmedByUserId || row.confirmed_by_user_id || null,
    confirmedByUsername: row.confirmedByUsername || row.confirmed_by_username || null,
    cancelledAt: row.cancelledAt || row.cancelled_at || null,
    cancelledByUserId: row.cancelledByUserId || row.cancelled_by_user_id || null,
    cancelledByUsername: row.cancelledByUsername || row.cancelled_by_username || null,
    repartidaAt: row.repartidaAt || row.repartida_at || null,
    repartidaByUserId: row.repartidaByUserId || row.repartida_by_user_id || null,
    repartidaByUsername: row.repartidaByUsername || row.repartida_by_username || null,
  };
}

/** Partes de una venta según % globales (resto = costo+margen del producto). */
function splitSaleAmount(totalAmount, splits) {
  const total = Math.max(0, toNum(totalAmount, 0));
  const s = normalizeSplits(splits);
  const parts = {};
  let used = 0;
  SPLIT_KEYS.forEach((k) => {
    const v = roundMoney(total * (toNum(s[k], 0) / 100));
    parts[k] = v;
    used += v;
  });
  parts.resto = roundMoney(total - used);
  return { total, parts, splits: s };
}

function dayKeyFromIso(iso) {
  return String(iso || '').slice(0, 10);
}

function inDateRange(iso, fromDay, toDay) {
  const day = dayKeyFromIso(iso);
  if (!day) return false;
  if (fromDay && day < fromDay) return false;
  if (toDay && day > toDay) return false;
  return true;
}

function buildPeriodReport(orders, splits, fromDay, toDay) {
  const sales = (orders || [])
    .filter((o) => o && o.status === 'venta')
    .filter((o) => inDateRange(o.confirmedAt, fromDay, toDay))
    .map((o) => {
      const split = splitSaleAmount(o.totalAmount, splits);
      return { ...o, split };
    });

  const totals = {
    count: sales.length,
    amount: 0,
    repartidas: 0,
    pendientes: 0,
    parts: {
      impuestos: 0,
      exhatech: 0,
      vendedor: 0,
      comision_bancaria: 0,
      resto: 0,
    },
  };

  sales.forEach((o) => {
    totals.amount = roundMoney(totals.amount + toNum(o.totalAmount, 0));
    if (o.repartida) totals.repartidas += 1;
    else totals.pendientes += 1;
    SPLIT_KEYS.forEach((k) => {
      totals.parts[k] = roundMoney(totals.parts[k] + toNum(o.split.parts[k], 0));
    });
    totals.parts.resto = roundMoney(totals.parts.resto + toNum(o.split.parts.resto, 0));
  });

  return {
    from: fromDay,
    to: toDay,
    splits: normalizeSplits(splits),
    sales,
    totals,
  };
}

/**
 * Arma una orden (aún no venta). Stock se valida fuera si no es contra pedido.
 */
function buildOrderInput(body, products, user) {
  const actor = actorFromUser(user);
  if (!actor.userId) throw new Error('Usuario inválido');
  const rawItems = Array.isArray(body && body.items) ? body.items : [];
  if (!rawItems.length) throw new Error('Agregá al menos un producto');

  const contraPedido = !!(body && (body.contraPedido || body.contra_pedido));
  const withInvoice = !!(body && (body.withInvoice || body.with_invoice || body.conFactura));
  const byId = new Map((products || []).map((p) => [String(p.id), p]));
  const items = [];

  rawItems.forEach((raw) => {
    const productId = String((raw && (raw.productId || raw.id)) || '').trim();
    const qty = toNum(raw && raw.qty, 0);
    if (!productId || !(qty > 0)) return;
    const product = byId.get(productId);
    if (!product || product.active === false) {
      throw new Error('Producto no encontrado o inactivo');
    }
    if (!contraPedido) {
      const stock = toNum(product.stockQty, 0);
      if (stock < qty) {
        throw new Error(
          'Stock insuficiente para "' + product.name + '" (hay ' + stock + ', pedís ' + qty + '). Usá contra pedido si aplica.'
        );
      }
    }
    const defaultUnit = product.effectivePrice != null
      ? product.effectivePrice
      : effectivePrice(product.salePrice, product.discountPercent);
    const unitPrice = Math.max(
      0,
      toNum(raw.unitPrice, toNum(defaultUnit, 0))
    );
    items.push({
      id: uid('oi'),
      productId,
      productName: product.name,
      qty,
      unitPrice,
      lineTotal: Math.round(qty * unitPrice * 100) / 100,
    });
  });
  if (!items.length) throw new Error('Agregá al menos un producto con cantidad');

  const now = nowIso();
  const totalAmount = Math.round(
    items.reduce((acc, it) => acc + it.lineTotal, 0) * 100
  ) / 100;

  return {
    id: uid('ord'),
    status: 'orden',
    withInvoice,
    contraPedido,
    stockReserved: !contraPedido,
    customerName: String((body && body.customerName) || '').trim(),
    customerIdNumber: String((body && body.customerIdNumber) || '').trim(),
    customerEmail: String((body && body.customerEmail) || '').trim(),
    customerPhone: String((body && body.customerPhone) || '').trim(),
    customerAddress: String((body && body.customerAddress) || '').trim(),
    notes: String((body && body.notes) || '').trim(),
    totalAmount,
    items,
    createdAt: now,
    createdByUserId: actor.userId,
    createdByUsername: actor.username,
    confirmedAt: null,
    confirmedByUserId: null,
    confirmedByUsername: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancelledByUsername: null,
    repartida: false,
    repartidaAt: null,
    repartidaByUserId: null,
    repartidaByUsername: null,
  };
}

module.exports = {
  SPLIT_KEYS,
  SPLIT_DEFAULTS,
  uid,
  nowIso,
  emptySplits,
  normalizeSplits,
  normalizeCommissions,
  normalizeSettings,
  normalizeProduct,
  buildProductInput,
  actorFromUser,
  defaultSettings,
  photoObjectKey,
  extFromContentType,
  toNum,
  clampPct,
  clampNonNeg,
  roundMoney,
  sumSplitPct,
  computeMinPrice,
  computeSaleFromMargin,
  computeMarginFromSale,
  marginMoney,
  maxDiscountPercent,
  effectivePrice,
  enrichProductPricing,
  normalizePurchase,
  normalizePurchaseItem,
  buildPurchaseInput,
  normalizeOrder,
  normalizeOrderItem,
  normalizeOrderStatus,
  buildOrderInput,
  splitSaleAmount,
  buildPeriodReport,
  dayKeyFromIso,
  inDateRange,
};
