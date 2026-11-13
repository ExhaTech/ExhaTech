/**
 * Inventario local (Node): catálogo compartido en JSON + fotos en disco.
 * data/inventario/catalog.json
 * data/inventario/photos/{productId}.{ext}
 */
const fs = require('fs');
const path = require('path');
const model = require('./inventario-model');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'inventario');
const CATALOG_FILE = path.join(DIR, 'catalog.json');
const PHOTOS_DIR = path.join(DIR, 'photos');

function ensureDirs() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

function defaultCatalog() {
  return {
    version: 3,
    settings: model.defaultSettings(),
    products: [],
    purchases: [],
    orders: [],
  };
}

function loadCatalog() {
  ensureDirs();
  if (!fs.existsSync(CATALOG_FILE)) {
    const fresh = defaultCatalog();
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(fresh, null, 2), 'utf8');
    return fresh;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    const cat = {
      version: 3,
      settings: model.normalizeSettings(raw.settings || model.defaultSettings()),
      products: Array.isArray(raw.products)
        ? raw.products.map(model.normalizeProduct).filter(Boolean)
        : [],
      purchases: Array.isArray(raw.purchases)
        ? raw.purchases.map(model.normalizePurchase).filter(Boolean)
        : [],
      orders: Array.isArray(raw.orders)
        ? raw.orders.map(model.normalizeOrder).filter(Boolean)
        : [],
    };
    return cat;
  } catch {
    return defaultCatalog();
  }
}

function saveCatalog(cat) {
  ensureDirs();
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(cat, null, 2), 'utf8');
}

function getSettings() {
  return loadCatalog().settings;
}

function saveSettings(user, splitsRaw) {
  const cat = loadCatalog();
  const actor = model.actorFromUser(user);
  cat.settings = {
    splits: model.normalizeSplits(splitsRaw),
    updatedAt: model.nowIso(),
    updatedByUserId: actor.userId,
    updatedByUsername: actor.username,
  };
  saveCatalog(cat);
  return cat.settings;
}

function listProducts(opts) {
  const includeInactive = !!(opts && opts.includeInactive);
  const cat = loadCatalog();
  const products = cat.products
    .filter((p) => includeInactive || p.active)
    .slice()
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.name).localeCompare(String(b.name), 'es');
    })
    .map((p) => model.enrichProductPricing(p, cat.settings.splits));
  return products;
}

function getProduct(id) {
  if (!id) return null;
  const cat = loadCatalog();
  const p = cat.products.find((x) => x.id === String(id)) || null;
  return p ? model.enrichProductPricing(p, cat.settings.splits) : null;
}

function saveProduct(user, body) {
  const cat = loadCatalog();
  const existing = body && body.id
    ? cat.products.find((p) => p.id === String(body.id)) || null
    : null;
  const input = model.buildProductInput(body, existing, user, cat.settings.splits);
  const product = model.normalizeProduct({
    ...input,
    commissions: input.commissions,
    photoKey: input.photoKey,
    photoContentType: input.photoContentType,
  });
  if (existing) {
    cat.products = cat.products.map((p) => (p.id === product.id ? product : p));
  } else {
    cat.products.push(product);
  }
  saveCatalog(cat);
  return model.enrichProductPricing(product, cat.settings.splits);
}

function deleteProduct(user, id) {
  const cat = loadCatalog();
  const existing = cat.products.find((p) => p.id === String(id));
  if (!existing) throw new Error('Producto no encontrado');
  // Soft-delete + limpia foto de disco
  if (existing.photoKey) {
    const file = path.join(PHOTOS_DIR, path.basename(existing.photoKey));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  const actor = model.actorFromUser(user);
  const updated = {
    ...existing,
    active: false,
    photoKey: null,
    photoContentType: null,
    hasPhoto: false,
    updatedAt: model.nowIso(),
    updatedByUserId: actor.userId,
    updatedByUsername: actor.username,
  };
  cat.products = cat.products.map((p) => (p.id === id ? updated : p));
  saveCatalog(cat);
  return updated;
}

function savePhoto(user, productId, contentType, buffer) {
  const cat = loadCatalog();
  const existing = cat.products.find((p) => p.id === String(productId));
  if (!existing) throw new Error('Producto no encontrado');
  if (!buffer || !buffer.length) throw new Error('Foto vacía');
  if (buffer.length > 2.5 * 1024 * 1024) throw new Error('Foto máxima 2.5 MB');
  const ct = String(contentType || 'application/octet-stream');
  if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(ct)) {
    throw new Error('Formato de imagen no permitido');
  }
  ensureDirs();
  const ext = model.extFromContentType(ct);
  const key = model.photoObjectKey(productId, ext);
  const file = path.join(PHOTOS_DIR, path.basename(key));
  // Borra foto previa con otra extensión
  if (existing.photoKey) {
    const prev = path.join(PHOTOS_DIR, path.basename(existing.photoKey));
    if (prev !== file && fs.existsSync(prev)) fs.unlinkSync(prev);
  }
  fs.writeFileSync(file, buffer);
  const actor = model.actorFromUser(user);
  const updated = {
    ...existing,
    photoKey: key,
    photoContentType: ct,
    hasPhoto: true,
    updatedAt: model.nowIso(),
    updatedByUserId: actor.userId,
    updatedByUsername: actor.username,
  };
  cat.products = cat.products.map((p) => (p.id === productId ? updated : p));
  saveCatalog(cat);
  return updated;
}

function readPhoto(productId) {
  const product = getProduct(productId);
  if (!product || !product.photoKey) return null;
  const file = path.join(PHOTOS_DIR, path.basename(product.photoKey));
  if (!fs.existsSync(file)) return null;
  return {
    buffer: fs.readFileSync(file),
    contentType: product.photoContentType || 'application/octet-stream',
  };
}

function applyStockDelta(cat, productId, qtyDelta, unitCost, actor, now) {
  const idx = cat.products.findIndex((p) => p.id === String(productId));
  if (idx < 0) throw new Error('Producto no encontrado');
  const p = cat.products[idx];
  const nextStock = Math.max(0, model.toNum(p.stockQty, 0) + qtyDelta);
  const next = {
    ...p,
    stockQty: nextStock,
    updatedAt: now,
    updatedByUserId: actor.userId,
    updatedByUsername: actor.username,
  };
  if (unitCost > 0) next.costPrice = unitCost;
  cat.products[idx] = next;
}

function listPurchases(limit) {
  const n = Math.min(100, Math.max(1, Number(limit) || 40));
  return loadCatalog().purchases
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, n);
}

function getPurchase(id) {
  if (!id) return null;
  return loadCatalog().purchases.find((p) => p.id === String(id)) || null;
}

function createPurchase(user, body) {
  const cat = loadCatalog();
  const purchase = model.normalizePurchase(
    model.buildPurchaseInput(body, cat.products, user)
  );
  const actor = model.actorFromUser(user);
  const now = purchase.createdAt;
  purchase.items.forEach((it) => {
    applyStockDelta(cat, it.productId, it.qty, it.unitCost, actor, now);
  });
  cat.purchases.unshift(purchase);
  saveCatalog(cat);
  return purchase;
}

function cancelPurchase(user, id) {
  const cat = loadCatalog();
  const purchase = cat.purchases.find((p) => p.id === String(id));
  if (!purchase) throw new Error('Compra no encontrada');
  if (purchase.status === 'cancelled') throw new Error('La compra ya está cancelada');
  const actor = model.actorFromUser(user);
  const now = model.nowIso();
  purchase.items.forEach((it) => {
    applyStockDelta(cat, it.productId, -it.qty, 0, actor, now);
  });
  purchase.status = 'cancelled';
  purchase.cancelledAt = now;
  purchase.cancelledByUserId = actor.userId;
  purchase.cancelledByUsername = actor.username;
  cat.purchases = cat.purchases.map((p) => (p.id === purchase.id ? purchase : p));
  saveCatalog(cat);
  return purchase;
}

function listOrders(limit) {
  const n = Math.min(100, Math.max(1, Number(limit) || 50));
  return loadCatalog().orders
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, n);
}

function getOrder(id) {
  if (!id) return null;
  return loadCatalog().orders.find((o) => o.id === String(id)) || null;
}

function createOrder(user, body) {
  const cat = loadCatalog();
  const order = model.normalizeOrder(
    model.buildOrderInput(body, cat.products, user)
  );
  const actor = model.actorFromUser(user);
  if (order.stockReserved) {
    order.items.forEach((it) => {
      applyStockDelta(cat, it.productId, -it.qty, 0, actor, order.createdAt);
    });
  }
  cat.orders.unshift(order);
  saveCatalog(cat);
  return order;
}

function confirmOrder(user, id) {
  const cat = loadCatalog();
  const order = cat.orders.find((o) => o.id === String(id));
  if (!order) throw new Error('Orden no encontrada');
  if (order.status === 'cancelada') throw new Error('La orden está cancelada');
  if (order.status === 'venta') throw new Error('Ya está declarada como venta');
  if (order.status !== 'orden') throw new Error('Solo se confirma desde estado orden');
  const actor = model.actorFromUser(user);
  const now = model.nowIso();
  order.status = 'venta';
  order.confirmedAt = now;
  order.confirmedByUserId = actor.userId;
  order.confirmedByUsername = actor.username;
  cat.orders = cat.orders.map((o) => (o.id === order.id ? order : o));
  saveCatalog(cat);
  return order;
}

function cancelOrder(user, id) {
  const cat = loadCatalog();
  const order = cat.orders.find((o) => o.id === String(id));
  if (!order) throw new Error('Orden no encontrada');
  if (order.status === 'cancelada') throw new Error('La orden ya está cancelada');
  const actor = model.actorFromUser(user);
  const now = model.nowIso();
  if (order.stockReserved) {
    order.items.forEach((it) => {
      applyStockDelta(cat, it.productId, it.qty, 0, actor, now);
    });
  }
  order.status = 'cancelada';
  order.cancelledAt = now;
  order.cancelledByUserId = actor.userId;
  order.cancelledByUsername = actor.username;
  order.stockReserved = false;
  cat.orders = cat.orders.map((o) => (o.id === order.id ? order : o));
  saveCatalog(cat);
  return order;
}

function markOrderRepartida(user, id, repartida) {
  const cat = loadCatalog();
  const order = cat.orders.find((o) => o.id === String(id));
  if (!order) throw new Error('Orden no encontrada');
  if (order.status !== 'venta') {
    throw new Error('Solo se marca reparto en ventas concretadas');
  }
  const actor = model.actorFromUser(user);
  const now = model.nowIso();
  const flag = repartida !== false;
  order.repartida = flag;
  order.repartidaAt = flag ? now : null;
  order.repartidaByUserId = flag ? actor.userId : null;
  order.repartidaByUsername = flag ? actor.username : null;
  cat.orders = cat.orders.map((o) => (o.id === order.id ? order : o));
  saveCatalog(cat);
  return order;
}

function periodReport(fromDay, toDay) {
  const cat = loadCatalog();
  const from = model.dayKeyFromIso(fromDay) || model.dayKeyFromIso(model.nowIso());
  const to = model.dayKeyFromIso(toDay) || model.dayKeyFromIso(model.nowIso());
  return model.buildPeriodReport(cat.orders, cat.settings.splits, from, to);
}

module.exports = {
  getSettings,
  saveSettings,
  listProducts,
  getProduct,
  saveProduct,
  deleteProduct,
  savePhoto,
  readPhoto,
  listPurchases,
  getPurchase,
  createPurchase,
  cancelPurchase,
  listOrders,
  getOrder,
  createOrder,
  confirmOrder,
  cancelOrder,
  markOrderRepartida,
  periodReport,
};
