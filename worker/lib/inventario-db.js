/**
 * Inventario en D1 (catálogo compartido Mayoreo Kenneth).
 */
import {
  actorFromUser,
  buildProductInput,
  buildPurchaseInput,
  buildOrderInput,
  normalizeProduct,
  normalizePurchase,
  normalizeOrder,
  normalizeSettings,
  normalizeSplits,
  enrichProductPricing,
  buildPeriodReport,
  dayKeyFromIso,
  nowIso,
  photoObjectKey,
  extFromContentType,
  toNum,
} from './inventario-model.js';

function settingsSelect() {
  return `
    SELECT
      id,
      split_impuestos AS splitImpuestos,
      split_pagina_web AS splitPaginaWeb,
      split_venta AS splitVenta,
      split_exhatech AS splitExhatech,
      split_vendedor AS splitVendedor,
      split_comision_bancaria AS splitComisionBancaria,
      updated_at AS updatedAt,
      updated_by_user_id AS updatedByUserId,
      updated_by_username AS updatedByUsername
    FROM inventory_settings
    WHERE id = 1
    LIMIT 1
  `;
}

function productSelect() {
  return `
    SELECT
      id,
      name,
      description,
      photo_key AS photoKey,
      photo_content_type AS photoContentType,
      stock_qty AS stockQty,
      cost_price AS costPrice,
      sale_price AS salePrice,
      margin_percent AS marginPercent,
      discount_percent AS discountPercent,
      commissions_json AS commissions_json,
      split_override_json AS split_override_json,
      active,
      sort_order AS sortOrder,
      created_at AS createdAt,
      created_by_user_id AS createdByUserId,
      created_by_username AS createdByUsername,
      updated_at AS updatedAt,
      updated_by_user_id AS updatedByUserId,
      updated_by_username AS updatedByUsername
    FROM inventory_products
  `;
}

export async function getSettings(env) {
  const row = await env.DB.prepare(settingsSelect()).first();
  if (!row) {
    const now = nowIso();
    await env.DB.prepare(`
      INSERT OR IGNORE INTO inventory_settings (
        id, split_impuestos, split_pagina_web, split_venta, split_ganancia, split_costo,
        split_exhatech, split_vendedor, split_comision_bancaria,
        updated_at, updated_by_user_id, updated_by_username
      ) VALUES (1, 13, 0, 0, 0, 0, 2.5, 10, 0, ?, NULL, NULL)
    `).bind(now).run();
    return normalizeSettings(null);
  }
  return normalizeSettings(row);
}

export async function saveSettings(env, user, splitsRaw) {
  const splits = normalizeSplits(splitsRaw);
  const actor = actorFromUser(user);
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO inventory_settings (
      id, split_impuestos, split_pagina_web, split_venta, split_ganancia, split_costo,
      split_exhatech, split_vendedor, split_comision_bancaria,
      updated_at, updated_by_user_id, updated_by_username
    ) VALUES (1, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      split_impuestos = excluded.split_impuestos,
      split_exhatech = excluded.split_exhatech,
      split_vendedor = excluded.split_vendedor,
      split_comision_bancaria = excluded.split_comision_bancaria,
      updated_at = excluded.updated_at,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_by_username = excluded.updated_by_username
  `).bind(
    splits.impuestos,
    splits.exhatech,
    splits.vendedor,
    splits.comision_bancaria,
    now,
    actor.userId,
    actor.username
  ).run();
  return getSettings(env);
}

export async function listProducts(env, opts) {
  const includeInactive = !!(opts && opts.includeInactive);
  const settings = await getSettings(env);
  const sql = `
    ${productSelect()}
    ${includeInactive ? '' : 'WHERE active = 1'}
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `;
  const result = await env.DB.prepare(sql).all();
  const rows = Array.isArray(result && result.results) ? result.results : [];
  return rows
    .map(normalizeProduct)
    .map((p) => enrichProductPricing(p, settings.splits));
}

export async function getProduct(env, id) {
  if (!id) return null;
  const settings = await getSettings(env);
  const row = await env.DB.prepare(`
    ${productSelect()}
    WHERE id = ?
    LIMIT 1
  `).bind(String(id)).first();
  const product = normalizeProduct(row);
  return product ? enrichProductPricing(product, settings.splits) : null;
}

export async function saveProduct(env, user, body) {
  const settings = await getSettings(env);
  const existingRow = body && body.id
    ? await env.DB.prepare(`${productSelect()} WHERE id = ? LIMIT 1`).bind(String(body.id)).first()
    : null;
  const existing = existingRow ? normalizeProduct(existingRow) : null;
  const input = buildProductInput(body, existing, user, settings.splits);
  await env.DB.prepare(`
    INSERT INTO inventory_products (
      id, name, description, photo_key, photo_content_type,
      stock_qty, cost_price, sale_price, margin_percent, discount_percent,
      commissions_json, split_override_json, active, sort_order,
      created_at, created_by_user_id, created_by_username,
      updated_at, updated_by_user_id, updated_by_username
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      stock_qty = excluded.stock_qty,
      cost_price = excluded.cost_price,
      sale_price = excluded.sale_price,
      margin_percent = excluded.margin_percent,
      discount_percent = excluded.discount_percent,
      commissions_json = excluded.commissions_json,
      split_override_json = NULL,
      active = excluded.active,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_by_username = excluded.updated_by_username
  `).bind(
    input.id,
    input.name,
    input.description,
    existing ? existing.photoKey : null,
    existing ? existing.photoContentType : null,
    input.stockQty,
    input.costPrice,
    input.salePrice,
    input.marginPercent,
    input.discountPercent,
    JSON.stringify(input.commissions || []),
    input.active ? 1 : 0,
    input.sortOrder,
    input.createdAt,
    input.createdByUserId,
    input.createdByUsername,
    input.updatedAt,
    input.updatedByUserId,
    input.updatedByUsername
  ).run();
  return getProduct(env, input.id);
}

export async function deleteProduct(env, user, id) {
  const existing = await getProduct(env, id);
  if (!existing) throw new Error('Producto no encontrado');
  if (existing.photoKey && env.DATA) {
    try {
      await env.DATA.delete(existing.photoKey);
    } catch {
      /* ignore */
    }
  }
  const actor = actorFromUser(user);
  const now = nowIso();
  await env.DB.prepare(`
    UPDATE inventory_products
    SET active = 0,
        photo_key = NULL,
        photo_content_type = NULL,
        updated_at = ?,
        updated_by_user_id = ?,
        updated_by_username = ?
    WHERE id = ?
  `).bind(now, actor.userId, actor.username, String(id)).run();
  return getProduct(env, id);
}

export async function savePhoto(env, user, productId, contentType, bytes) {
  const existing = await getProduct(env, productId);
  if (!existing) throw new Error('Producto no encontrado');
  if (!bytes || !bytes.byteLength) throw new Error('Foto vacía');
  if (bytes.byteLength > 2.5 * 1024 * 1024) throw new Error('Foto máxima 2.5 MB');
  const ct = String(contentType || 'application/octet-stream');
  if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(ct)) {
    throw new Error('Formato de imagen no permitido');
  }
  if (!env.DATA) throw new Error('R2 no configurado');
  const ext = extFromContentType(ct);
  const key = photoObjectKey(productId, ext);
  if (existing.photoKey && existing.photoKey !== key) {
    try { await env.DATA.delete(existing.photoKey); } catch { /* ignore */ }
  }
  await env.DATA.put(key, bytes, {
    httpMetadata: { contentType: ct },
  });
  const actor = actorFromUser(user);
  const now = nowIso();
  await env.DB.prepare(`
    UPDATE inventory_products
    SET photo_key = ?,
        photo_content_type = ?,
        updated_at = ?,
        updated_by_user_id = ?,
        updated_by_username = ?
    WHERE id = ?
  `).bind(key, ct, now, actor.userId, actor.username, String(productId)).run();
  return getProduct(env, productId);
}

export async function readPhoto(env, productId) {
  const product = await getProduct(env, productId);
  if (!product || !product.photoKey || !env.DATA) return null;
  const obj = await env.DATA.get(product.photoKey);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return {
    bytes: ab,
    contentType: product.photoContentType
      || (obj.httpMetadata && obj.httpMetadata.contentType)
      || 'application/octet-stream',
  };
}

async function loadPurchaseItems(env, purchaseId) {
  const result = await env.DB.prepare(`
    SELECT
      id,
      purchase_id AS purchaseId,
      product_id AS productId,
      product_name AS productName,
      qty,
      unit_cost AS unitCost
    FROM inventory_purchase_items
    WHERE purchase_id = ?
    ORDER BY rowid ASC
  `).bind(String(purchaseId)).all();
  const rows = Array.isArray(result && result.results) ? result.results : [];
  return rows;
}

export async function getPurchase(env, id) {
  if (!id) return null;
  const row = await env.DB.prepare(`
    SELECT
      id,
      supplier_name AS supplierName,
      notes,
      status,
      created_at AS createdAt,
      created_by_user_id AS createdByUserId,
      created_by_username AS createdByUsername,
      cancelled_at AS cancelledAt,
      cancelled_by_user_id AS cancelledByUserId,
      cancelled_by_username AS cancelledByUsername
    FROM inventory_purchases
    WHERE id = ?
    LIMIT 1
  `).bind(String(id)).first();
  if (!row) return null;
  const items = await loadPurchaseItems(env, id);
  return normalizePurchase({ ...row, items });
}

export async function listPurchases(env, limit) {
  const n = Math.min(100, Math.max(1, Number(limit) || 40));
  const result = await env.DB.prepare(`
    SELECT
      id,
      supplier_name AS supplierName,
      notes,
      status,
      created_at AS createdAt,
      created_by_user_id AS createdByUserId,
      created_by_username AS createdByUsername,
      cancelled_at AS cancelledAt,
      cancelled_by_user_id AS cancelledByUserId,
      cancelled_by_username AS cancelledByUsername
    FROM inventory_purchases
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(n).all();
  const rows = Array.isArray(result && result.results) ? result.results : [];
  const out = [];
  for (const row of rows) {
    const items = await loadPurchaseItems(env, row.id);
    out.push(normalizePurchase({ ...row, items }));
  }
  return out;
}

async function bumpStock(env, productId, qtyDelta, unitCost, actor, now) {
  const product = await getProduct(env, productId);
  if (!product) throw new Error('Producto no encontrado');
  const nextStock = Math.max(0, toNum(product.stockQty, 0) + qtyDelta);
  const nextCost = unitCost > 0 ? unitCost : product.costPrice;
  await env.DB.prepare(`
    UPDATE inventory_products
    SET stock_qty = ?,
        cost_price = ?,
        updated_at = ?,
        updated_by_user_id = ?,
        updated_by_username = ?
    WHERE id = ?
  `).bind(
    nextStock,
    nextCost,
    now,
    actor.userId,
    actor.username,
    String(productId)
  ).run();
}

export async function createPurchase(env, user, body) {
  const products = await listProducts(env, { includeInactive: false });
  const purchase = normalizePurchase(buildPurchaseInput(body, products, user));
  const actor = actorFromUser(user);

  const stmts = [
    env.DB.prepare(`
      INSERT INTO inventory_purchases (
        id, supplier_name, notes, status,
        created_at, created_by_user_id, created_by_username,
        cancelled_at, cancelled_by_user_id, cancelled_by_username
      ) VALUES (?, ?, ?, 'confirmed', ?, ?, ?, NULL, NULL, NULL)
    `).bind(
      purchase.id,
      purchase.supplierName,
      purchase.notes,
      purchase.createdAt,
      purchase.createdByUserId,
      purchase.createdByUsername
    ),
  ];

  purchase.items.forEach((it) => {
    stmts.push(
      env.DB.prepare(`
        INSERT INTO inventory_purchase_items (
          id, purchase_id, product_id, product_name, qty, unit_cost
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(it.id, purchase.id, it.productId, it.productName, it.qty, it.unitCost)
    );
  });

  await env.DB.batch(stmts);

  for (const it of purchase.items) {
    await bumpStock(env, it.productId, it.qty, it.unitCost, actor, purchase.createdAt);
  }

  return getPurchase(env, purchase.id);
}

export async function cancelPurchase(env, user, id) {
  const purchase = await getPurchase(env, id);
  if (!purchase) throw new Error('Compra no encontrada');
  if (purchase.status === 'cancelled') throw new Error('La compra ya está cancelada');
  const actor = actorFromUser(user);
  const now = nowIso();

  await env.DB.prepare(`
    UPDATE inventory_purchases
    SET status = 'cancelled',
        cancelled_at = ?,
        cancelled_by_user_id = ?,
        cancelled_by_username = ?
    WHERE id = ?
  `).bind(now, actor.userId, actor.username, String(id)).run();

  for (const it of purchase.items) {
    await bumpStock(env, it.productId, -it.qty, 0, actor, now);
  }

  return getPurchase(env, id);
}

async function loadOrderItems(env, orderId) {
  const result = await env.DB.prepare(`
    SELECT
      id,
      order_id AS orderId,
      product_id AS productId,
      product_name AS productName,
      qty,
      unit_price AS unitPrice
    FROM inventory_order_items
    WHERE order_id = ?
    ORDER BY rowid ASC
  `).bind(String(orderId)).all();
  return Array.isArray(result && result.results) ? result.results : [];
}

export async function getOrder(env, id) {
  if (!id) return null;
  const row = await env.DB.prepare(`
    SELECT
      id,
      status,
      with_invoice AS withInvoice,
      contra_pedido AS contraPedido,
      stock_reserved AS stockReserved,
      repartida,
      customer_name AS customerName,
      customer_id_number AS customerIdNumber,
      customer_email AS customerEmail,
      customer_phone AS customerPhone,
      customer_address AS customerAddress,
      notes,
      total_amount AS totalAmount,
      created_at AS createdAt,
      created_by_user_id AS createdByUserId,
      created_by_username AS createdByUsername,
      confirmed_at AS confirmedAt,
      confirmed_by_user_id AS confirmedByUserId,
      confirmed_by_username AS confirmedByUsername,
      cancelled_at AS cancelledAt,
      cancelled_by_user_id AS cancelledByUserId,
      cancelled_by_username AS cancelledByUsername,
      repartida_at AS repartidaAt,
      repartida_by_user_id AS repartidaByUserId,
      repartida_by_username AS repartidaByUsername
    FROM inventory_orders
    WHERE id = ?
    LIMIT 1
  `).bind(String(id)).first();
  if (!row) return null;
  const items = await loadOrderItems(env, id);
  return normalizeOrder({ ...row, items });
}

export async function listOrders(env, limit) {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  const result = await env.DB.prepare(`
    SELECT
      id,
      status,
      with_invoice AS withInvoice,
      contra_pedido AS contraPedido,
      stock_reserved AS stockReserved,
      repartida,
      customer_name AS customerName,
      customer_id_number AS customerIdNumber,
      customer_email AS customerEmail,
      customer_phone AS customerPhone,
      customer_address AS customerAddress,
      notes,
      total_amount AS totalAmount,
      created_at AS createdAt,
      created_by_user_id AS createdByUserId,
      created_by_username AS createdByUsername,
      confirmed_at AS confirmedAt,
      confirmed_by_user_id AS confirmedByUserId,
      confirmed_by_username AS confirmedByUsername,
      cancelled_at AS cancelledAt,
      cancelled_by_user_id AS cancelledByUserId,
      cancelled_by_username AS cancelledByUsername,
      repartida_at AS repartidaAt,
      repartida_by_user_id AS repartidaByUserId,
      repartida_by_username AS repartidaByUsername
    FROM inventory_orders
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(n).all();
  const rows = Array.isArray(result && result.results) ? result.results : [];
  const out = [];
  for (const row of rows) {
    const items = await loadOrderItems(env, row.id);
    out.push(normalizeOrder({ ...row, items }));
  }
  return out;
}

export async function createOrder(env, user, body) {
  const products = await listProducts(env, { includeInactive: false });
  const order = normalizeOrder(buildOrderInput(body, products, user));
  const actor = actorFromUser(user);

  const stmts = [
    env.DB.prepare(`
      INSERT INTO inventory_orders (
        id, status, with_invoice, contra_pedido, stock_reserved, repartida,
        customer_name, customer_id_number, customer_email, customer_phone, customer_address,
        notes, total_amount,
        created_at, created_by_user_id, created_by_username,
        confirmed_at, confirmed_by_user_id, confirmed_by_username,
        cancelled_at, cancelled_by_user_id, cancelled_by_username,
        repartida_at, repartida_by_user_id, repartida_by_username
      ) VALUES (?, 'orden', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    `).bind(
      order.id,
      order.withInvoice ? 1 : 0,
      order.contraPedido ? 1 : 0,
      order.stockReserved ? 1 : 0,
      order.customerName,
      order.customerIdNumber,
      order.customerEmail,
      order.customerPhone,
      order.customerAddress,
      order.notes,
      order.totalAmount,
      order.createdAt,
      order.createdByUserId,
      order.createdByUsername
    ),
  ];

  order.items.forEach((it) => {
    stmts.push(
      env.DB.prepare(`
        INSERT INTO inventory_order_items (
          id, order_id, product_id, product_name, qty, unit_price
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(it.id, order.id, it.productId, it.productName, it.qty, it.unitPrice)
    );
  });

  await env.DB.batch(stmts);

  if (order.stockReserved) {
    for (const it of order.items) {
      await bumpStock(env, it.productId, -it.qty, 0, actor, order.createdAt);
    }
  }

  return getOrder(env, order.id);
}

export async function confirmOrder(env, user, id) {
  const order = await getOrder(env, id);
  if (!order) throw new Error('Orden no encontrada');
  if (order.status === 'cancelada') throw new Error('La orden está cancelada');
  if (order.status === 'venta') throw new Error('Ya está declarada como venta');
  if (order.status !== 'orden') throw new Error('Solo se confirma desde estado orden');
  const actor = actorFromUser(user);
  const now = nowIso();
  await env.DB.prepare(`
    UPDATE inventory_orders
    SET status = 'venta',
        confirmed_at = ?,
        confirmed_by_user_id = ?,
        confirmed_by_username = ?
    WHERE id = ?
  `).bind(now, actor.userId, actor.username, String(id)).run();
  return getOrder(env, id);
}

export async function cancelOrder(env, user, id) {
  const order = await getOrder(env, id);
  if (!order) throw new Error('Orden no encontrada');
  if (order.status === 'cancelada') throw new Error('La orden ya está cancelada');
  const actor = actorFromUser(user);
  const now = nowIso();

  await env.DB.prepare(`
    UPDATE inventory_orders
    SET status = 'cancelada',
        stock_reserved = 0,
        cancelled_at = ?,
        cancelled_by_user_id = ?,
        cancelled_by_username = ?
    WHERE id = ?
  `).bind(now, actor.userId, actor.username, String(id)).run();

  if (order.stockReserved) {
    for (const it of order.items) {
      await bumpStock(env, it.productId, it.qty, 0, actor, now);
    }
  }

  return getOrder(env, id);
}

export async function markOrderRepartida(env, user, id, repartida) {
  const order = await getOrder(env, id);
  if (!order) throw new Error('Orden no encontrada');
  if (order.status !== 'venta') {
    throw new Error('Solo se marca reparto en ventas concretadas');
  }
  const actor = actorFromUser(user);
  const now = nowIso();
  const flag = repartida === false ? 0 : 1;
  await env.DB.prepare(`
    UPDATE inventory_orders
    SET repartida = ?,
        repartida_at = ?,
        repartida_by_user_id = ?,
        repartida_by_username = ?
    WHERE id = ?
  `).bind(
    flag,
    flag ? now : null,
    flag ? actor.userId : null,
    flag ? actor.username : null,
    String(id)
  ).run();
  return getOrder(env, id);
}

export async function periodReport(env, fromDay, toDay) {
  const settings = await getSettings(env);
  const from = dayKeyFromIso(fromDay) || dayKeyFromIso(nowIso());
  const to = dayKeyFromIso(toDay) || dayKeyFromIso(nowIso());
  const orders = await listOrders(env, 500);
  return buildPeriodReport(orders, settings.splits, from, to);
}
