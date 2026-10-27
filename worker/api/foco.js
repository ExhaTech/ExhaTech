import { json } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import * as focoStore from '../lib/foco-store.js';

const CLIENT_ERROR_RE = /obligatorio|encontrado|siguiente acción|Esperando|Después|fecha|existe|origen|rol|cuenta|forma|caja|monto|Máximo|Debe quedar|Catálogo|Dirección|inválid/i;

async function requireFocoAuth(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return { user: null, response: auth.errorResponse };
  return { user: auth.ctx.user, response: null };
}

export async function handleFoco(request, env, body) {
  const action = body && body.action;

  try {
    if (action === 'get') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      return json({ ok: true, data: await focoStore.getSnapshot(env, auth.user.id) }, 200);
    }

    if (action === 'saveCondo') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      const condo = await focoStore.saveCondo(env, auth.user.id, body);
      return json({
        ok: true,
        condo,
        data: await focoStore.getSnapshot(env, auth.user.id),
      }, 200);
    }

    if (action === 'deleteCondo') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.id) {
        return json({ error: 'Id de condominio obligatorio' }, 400);
      }
      await focoStore.deleteCondo(env, auth.user.id, body.id);
      return json({ ok: true, data: await focoStore.getSnapshot(env, auth.user.id) }, 200);
    }

    if (action === 'saveOrigen') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      const origen = await focoStore.saveOrigen(env, auth.user.id, body);
      return json({
        ok: true,
        origen,
        data: await focoStore.getSnapshot(env, auth.user.id),
      }, 200);
    }

    if (action === 'deleteOrigen') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.id) {
        return json({ error: 'Id de origen obligatorio' }, 400);
      }
      await focoStore.deleteOrigen(env, auth.user.id, body.id);
      return json({ ok: true, data: await focoStore.getSnapshot(env, auth.user.id) }, 200);
    }

    if (action === 'saveRole') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      const role = await focoStore.saveRole(env, auth.user.id, body);
      return json({
        ok: true,
        role,
        data: await focoStore.getSnapshot(env, auth.user.id),
      }, 200);
    }

    if (action === 'deleteRole') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.id) {
        return json({ error: 'Id de rol obligatorio' }, 400);
      }
      await focoStore.deleteRole(env, auth.user.id, body.id);
      return json({ ok: true, data: await focoStore.getSnapshot(env, auth.user.id) }, 200);
    }

    if (action === 'saveFormaPago') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      const formaPago = await focoStore.saveFormaPago(env, auth.user.id, body);
      return json({
        ok: true,
        formaPago,
        data: await focoStore.getSnapshot(env, auth.user.id),
      }, 200);
    }

    if (action === 'deleteFormaPago') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.id) {
        return json({ error: 'Id de forma de pago obligatorio' }, 400);
      }
      await focoStore.deleteFormaPago(env, auth.user.id, body.id);
      return json({ ok: true, data: await focoStore.getSnapshot(env, auth.user.id) }, 200);
    }

    if (action === 'saveCajaMov') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      const movimiento = await focoStore.saveCajaMov(env, auth.user.id, body);
      return json({
        ok: true,
        movimiento,
        data: await focoStore.getSnapshot(env, auth.user.id),
      }, 200);
    }

    if (action === 'deleteCajaMov') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.id) {
        return json({ error: 'Id de movimiento obligatorio' }, 400);
      }
      await focoStore.deleteCajaMov(env, auth.user.id, body.id);
      return json({ ok: true, data: await focoStore.getSnapshot(env, auth.user.id) }, 200);
    }

    if (action === 'saveContact') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      const contact = await focoStore.saveContact(env, auth.user.id, body);
      return json({
        ok: true,
        contact,
        data: await focoStore.getSnapshot(env, auth.user.id),
      }, 200);
    }

    if (action === 'moveCatalog') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.list || !body.id || !body.direction) {
        return json({ error: 'list, id y direction obligatorios' }, 400);
      }
      const data = await focoStore.moveCatalog(env, auth.user.id, body);
      return json({ ok: true, data }, 200);
    }

    if (action === 'deleteContact') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.id) {
        return json({ error: 'Id de contacto obligatorio' }, 400);
      }
      await focoStore.deleteContact(env, auth.user.id, body.id);
      return json({ ok: true, data: await focoStore.getSnapshot(env, auth.user.id) }, 200);
    }

    if (action === 'createItem') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      const item = await focoStore.createItem(env, auth.user.id, body);
      return json({
        ok: true,
        item,
        data: await focoStore.getSnapshot(env, auth.user.id),
      }, 200);
    }

    if (action === 'updateItem') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.id) {
        return json({ error: 'Id de ítem obligatorio' }, 400);
      }
      const item = await focoStore.updateItem(env, auth.user.id, body);
      return json({
        ok: true,
        item,
        data: await focoStore.getSnapshot(env, auth.user.id),
      }, 200);
    }

    if (action === 'moveItem') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.id || !body.status) {
        return json({ error: 'Id y status obligatorios' }, 400);
      }
      const moved = await focoStore.moveItem(env, auth.user.id, body);
      return json({
        ok: true,
        item: moved.item,
        clearedWait: moved.clearedWait || null,
        data: await focoStore.getSnapshot(env, auth.user.id),
      }, 200);
    }

    if (action === 'toggleAction') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.id || !body.actionId) {
        return json({ error: 'Id de ítem y de acción obligatorios' }, 400);
      }
      const item = await focoStore.toggleAction(env, auth.user.id, body);
      return json({
        ok: true,
        item,
        data: await focoStore.getSnapshot(env, auth.user.id),
      }, 200);
    }

    if (action === 'deleteItem') {
      const auth = await requireFocoAuth(request, env);
      if (auth.response) return auth.response;
      if (!body.id) {
        return json({ error: 'Id de ítem obligatorio' }, 400);
      }
      await focoStore.deleteItem(env, auth.user.id, body.id);
      return json({ ok: true, data: await focoStore.getSnapshot(env, auth.user.id) }, 200);
    }

    console.warn('Bitácora: acción desconocida →', action);
    return json(
      { error: 'Acción no reconocida: ' + String(action || '') + '. Reiniciá el server (node server.js).' },
      400
    );
  } catch (e) {
    const msg = e && e.message ? e.message : 'Error en Bitácora';
    return json({ error: msg }, CLIENT_ERROR_RE.test(msg) ? 400 : 500);
  }
}
