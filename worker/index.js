/**
 * ExhaTech — Cloudflare Worker
 * Sirve assets (sitio + Contabilidad + Bitácora) y APIs bajo /api/*.
 */
import { handleApi } from './api/router.js';
import { resolvePublicPath } from './lib/paths.js';
import { text } from './lib/http.js';

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---- APIs (Workers) ----
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, ctx);
      } catch (err) {
        console.error('api error', err && err.message ? err.message : err);
        return text('Internal error', 500);
      }
    }

    // ---- Estáticos + rewrites de subsitios ----
    if (!env.ASSETS) {
      return text('ASSETS binding missing — ¿corriste npm run cf:prepare?', 500);
    }

    const resolved = resolvePublicPath(url);
    if (resolved.redirect) {
      return Response.redirect(new URL(resolved.redirect, url.origin).toString(), 302);
    }

    const assetUrl = new URL(resolved.assetPath || '/', url.origin);
    return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  },
};
