/**
 * API Inventario — catálogo compartido Mayoreo Kenneth.
 * POST /api/inventario { action }
 * GET  /api/inventario/photo?id=...
 */
import { bytes, json } from '../lib/http.js';
import { requireModule } from '../lib/auth.js';
import * as invDb from '../lib/inventario-db.js';

const CLIENT_ERROR_RE = /obligatorio|encontrado|vacía|máxima|permitido|inválid|Nombre|Agregá|cancelada|inactivo|Stock insuficiente|declarada|confirma|venta|precio|descuento|mínimo|margen|reparto|repartida/i;

function decodeBase64Payload(raw) {
  const s = String(raw || '');
  const comma = s.indexOf(',');
  const b64 = comma >= 0 ? s.slice(comma + 1) : s;
  return Buffer.from(b64, 'base64');
}

export async function handleInventarioPhoto(request, env) {
  // <img> no manda X-Session-Token: se acepta ?token= solo en esta ruta.
  const url = new URL(request.url);
  const qToken = url.searchParams.get('token') || '';
  const req = qToken && !request.headers.get('X-Session-Token')
    ? new Request(request.url, {
      method: 'GET',
      headers: { 'X-Session-Token': qToken },
    })
    : request;
  const auth = await requireModule(req, env, 'inventario');
  if (auth.errorResponse) return auth.errorResponse;
  const id = url.searchParams.get('id') || '';
  const photo = await invDb.readPhoto(env, id);
  if (!photo) return json({ error: 'Foto no encontrada' }, 404);
  return bytes(photo.bytes, 200, photo.contentType, {
    'Cache-Control': 'private, max-age=300',
  });
}

export async function handleInventario(request, env, body) {
  const action = body && body.action;
  const auth = await requireModule(request, env, 'inventario');
  if (auth.errorResponse) return auth.errorResponse;
  const user = auth.ctx.user;

  try {
    if (action === 'bootstrap' || action === 'get') {
      const [settings, products, purchases, orders] = await Promise.all([
        invDb.getSettings(env),
        invDb.listProducts(env, { includeInactive: !!body.includeInactive }),
        invDb.listPurchases(env, body.purchaseLimit || 40),
        invDb.listOrders(env, body.orderLimit || 50),
      ]);
      return json({ ok: true, settings, products, purchases, orders }, 200);
    }

    if (action === 'settings.get') {
      return json({ ok: true, settings: await invDb.getSettings(env) }, 200);
    }

    if (action === 'settings.save') {
      const settings = await invDb.saveSettings(env, user, body.splits || body);
      return json({ ok: true, settings }, 200);
    }

    if (action === 'products.list') {
      const products = await invDb.listProducts(env, {
        includeInactive: !!body.includeInactive,
      });
      return json({ ok: true, products }, 200);
    }

    if (action === 'products.get') {
      const product = await invDb.getProduct(env, body.id);
      if (!product) return json({ error: 'Producto no encontrado' }, 404);
      return json({ ok: true, product }, 200);
    }

    if (action === 'products.save') {
      const product = await invDb.saveProduct(env, user, body);
      return json({ ok: true, product }, 200);
    }

    if (action === 'products.delete') {
      if (!body.id) return json({ error: 'Id obligatorio' }, 400);
      const product = await invDb.deleteProduct(env, user, body.id);
      return json({ ok: true, product }, 200);
    }

    if (action === 'products.photo.upload') {
      if (!body.id) return json({ error: 'Id obligatorio' }, 400);
      if (!body.dataBase64) return json({ error: 'Foto obligatoria' }, 400);
      const buf = decodeBase64Payload(body.dataBase64);
      const product = await invDb.savePhoto(
        env,
        user,
        body.id,
        body.contentType || 'image/jpeg',
        buf
      );
      return json({ ok: true, product }, 200);
    }

    if (action === 'purchases.list') {
      const purchases = await invDb.listPurchases(env, body.limit || 40);
      return json({ ok: true, purchases }, 200);
    }

    if (action === 'purchases.create') {
      const purchase = await invDb.createPurchase(env, user, body);
      const products = await invDb.listProducts(env, { includeInactive: false });
      return json({ ok: true, purchase, products }, 200);
    }

    if (action === 'purchases.cancel') {
      if (!body.id) return json({ error: 'Id obligatorio' }, 400);
      const purchase = await invDb.cancelPurchase(env, user, body.id);
      const products = await invDb.listProducts(env, { includeInactive: false });
      return json({ ok: true, purchase, products }, 200);
    }

    if (action === 'orders.list') {
      const orders = await invDb.listOrders(env, body.limit || 50);
      return json({ ok: true, orders }, 200);
    }

    if (action === 'orders.create') {
      const order = await invDb.createOrder(env, user, body);
      const products = await invDb.listProducts(env, { includeInactive: false });
      return json({ ok: true, order, products }, 200);
    }

    if (action === 'orders.confirm') {
      if (!body.id) return json({ error: 'Id obligatorio' }, 400);
      const order = await invDb.confirmOrder(env, user, body.id);
      return json({ ok: true, order }, 200);
    }

    if (action === 'orders.cancel') {
      if (!body.id) return json({ error: 'Id obligatorio' }, 400);
      const order = await invDb.cancelOrder(env, user, body.id);
      const products = await invDb.listProducts(env, { includeInactive: false });
      return json({ ok: true, order, products }, 200);
    }

    if (action === 'orders.markRepartida') {
      if (!body.id) return json({ error: 'Id obligatorio' }, 400);
      const order = await invDb.markOrderRepartida(env, user, body.id, body.repartida !== false);
      return json({ ok: true, order }, 200);
    }

    if (action === 'report.period') {
      const report = await invDb.periodReport(env, body.from || body.fromDay, body.to || body.toDay);
      return json({ ok: true, report }, 200);
    }

    return json({ error: 'unknown action' }, 400);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Error en Inventario';
    const status = CLIENT_ERROR_RE.test(msg) ? 400 : 500;
    return json({ error: msg }, status);
  }
}
