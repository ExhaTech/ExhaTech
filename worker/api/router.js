/**
 * Despacho de APIs. Contabilidad, Bitácora e Inventario en Workers.
 */
import { corsPreflight, json, readJson } from '../lib/http.js';
import { handleEhData } from './eh-data.js';
import { handleFoco } from './foco.js';
import { handleHealth } from './health.js';
import { handleInventario, handleInventarioPhoto } from './inventario.js';

/**
 * @param {Request} request
 * @param {import('../env').Env} env
 * @param {ExecutionContext} ctx
 */
export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    return corsPreflight();
  }

  if (path === '/api/health' && request.method === 'GET') {
    return handleHealth(env);
  }

  if (
    path === '/api/eh-data' ||
    path === '/api/eh-data.php' ||
    path === '/api/budget'
  ) {
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }
    const body = await readJson(request);
    if (body == null) {
      return json({ error: 'invalid body' }, 400);
    }
    return handleEhData(request, env, body);
  }

  if (path === '/api/foco') {
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }
    const body = await readJson(request);
    if (body == null) {
      return json({ error: 'invalid body' }, 400);
    }
    return handleFoco(request, env, body);
  }

  if (path === '/api/inventario/photo') {
    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405);
    }
    return handleInventarioPhoto(request, env);
  }

  if (path === '/api/inventario') {
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }
    const body = await readJson(request);
    if (body == null) {
      return json({ error: 'invalid body' }, 400);
    }
    return handleInventario(request, env, body);
  }

  return json({ error: 'not found', path }, 404);
}
