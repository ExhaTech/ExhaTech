/**
 * ExhaTech — Cloudflare Worker (app.exhatech.com)
 * Contabilidad + Bitácora + APIs bajo /api/*.
 * Marketing vive en Cloudflare Pages (exhatech.com).
 */
import { handleApi } from './api/router.js';
import { resolvePublicPath } from './lib/paths.js';
import { json, text } from './lib/http.js';

function isApiPath(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '') || '/';
  return p === '/api' || p.startsWith('/api/');
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---- APIs: SIEMPRE JSON (nunca HTML de Assets / error pages internas) ----
    if (isApiPath(url.pathname)) {
      try {
        const res = await handleApi(request, env, ctx);
        if (res) return res;
        return json({ error: 'not found', path: url.pathname }, 404);
      } catch (err) {
        console.error('api error', err && err.message ? err.message : err);
        return json({
          error: 'internal_error',
          message: err && err.message ? String(err.message) : 'Internal error',
        }, 500);
      }
    }

    // ---- Estáticos + rewrites de subsitios ----
    try {
      if (!env.ASSETS) {
        return text('ASSETS binding missing — ¿corriste npm run cf:prepare?', 500);
      }

      const resolved = resolvePublicPath(url);
      if (resolved.redirect) {
        return Response.redirect(new URL(resolved.redirect, url.origin).toString(), 302);
      }

      const assetUrl = new URL(resolved.assetPath || '/', url.origin);
      // GET limpio para assets (evita reenviar POST de formularios a estáticos)
      const assetReq = new Request(assetUrl.toString(), {
        method: 'GET',
        headers: request.headers,
      });
      return env.ASSETS.fetch(assetReq);
    } catch (err) {
      console.error('asset error', err && err.message ? err.message : err);
      return text('Asset error', 500);
    }
  },
};
