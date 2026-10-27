import { json } from '../lib/http.js';

/** Smoke check para DevOps / load balancer. */
export async function handleHealth(env) {
  const checks = {
    ok: true,
    app: env.APP_NAME || 'ExhaTech',
    environment: env.ENVIRONMENT || 'unknown',
    bindings: {
      db: !!env.DB,
      data: !!env.DATA,
      assets: !!env.ASSETS,
      sessionSecret: !!env.SESSION_SECRET,
      dataKey: !!(env.DATA_ENCRYPTION_KEY || env.BUDGET_MASTER_KEY),
    },
  };
  const missing = Object.entries(checks.bindings)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    checks.ok = false;
    checks.missing = missing;
  }
  return json(checks, checks.ok ? 200 : 503);
}
