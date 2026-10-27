/** Bindings generados a mano hasta `wrangler types`. */
interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  DATA: R2Bucket;
  APP_NAME: string;
  ENVIRONMENT: string;
  SESSION_SECRET: string;
  DATA_ENCRYPTION_KEY?: string;
  BUDGET_MASTER_KEY?: string;
  SEED_ADMIN_PASSWORD?: string;
}
