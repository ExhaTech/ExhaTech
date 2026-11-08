# Deploy ExhaTech en Cloudflare (DevOps)

## Arquitectura

| Host | Producto | Qué sirve |
|------|----------|-----------|
| `exhatech.com` | **Pages** → proyecto `exhatech` | Sitio marketing |
| `app.exhatech.com` | **Worker** → `exhatech` | Contabilidad, Bitácora, APIs |

```
exhatech.com          → Cloudflare Pages (Git → main)
app.exhatech.com      → Worker exhatech (Actions → wrangler deploy)
```

### Rutas del Worker (`app.exhatech.com`)

| Ruta | Qué es |
|------|--------|
| `/` | Redirect → `/contabilidad` |
| `/contabilidad` | UI Contabilidad (`eh-mnt.html`) |
| `/bitacora` | UI Bitácora (`foco.html`) |
| `/api/health` | Healthcheck |
| `/api/eh-data` | API Contabilidad |
| `/api/foco` | API Bitácora |

Datos sensibles: **D1** (usuarios/sesiones) + **R2** (JSON por usuario, cifrado).  
Credenciales: **Wrangler Secrets**, nunca en Git ni en `wrangler.jsonc`.

## Primera vez (cuenta)

```bash
cd ExhaTech
npm install
npm run cf:prepare

# D1 + R2 (si aún no existen)
npx wrangler d1 create exhatech-db   # pegar database_id en wrangler.jsonc
npx wrangler r2 bucket create exhatech-data
npx wrangler d1 migrations apply exhatech-db --remote

# Secrets (interactivo; no loguear valores)
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DATA_ENCRYPTION_KEY
# opcional:
npx wrangler secret put SEED_ADMIN_PASSWORD

# Deploy Worker + custom domain app.exhatech.com (definido en wrangler.jsonc)
npm run cf:deploy
```

Dashboard (Yurguen): **Workers → `exhatech` → Custom Domains → agregar `app.exhatech.com`**.

## CI — publicación automática (push a `main`)

### Sitio marketing → Pages

Proyecto: [Pages → exhatech](https://dash.cloudflare.com/bfe1e7148da1ca9e655e96c5c9c7a02e/pages/view/exhatech)

- Conectado al repo GitHub `ExhaTech/ExhaTech`
- Build: `node scripts/prepare-pages.mjs`
- Output: `pages-out` (solo marketing; sin Contabilidad/Bitácora)

### App → Worker

Workflow: `.github/workflows/deploy-app.yml`

1. `npm ci` + `npm run cf:prepare`
2. `wrangler deploy` → Worker `exhatech` + dominio `app.exhatech.com`

Secrets de GitHub Actions:

| Secret | Valor |
|--------|--------|
| `CLOUDFLARE_ACCOUNT_ID` | Account ID |
| `CLOUDFLARE_API_TOKEN` | Token **Edit Cloudflare Workers** (+ Pages Edit si hace falta) |

Secrets del Worker (`SESSION_SECRET`, `DATA_ENCRYPTION_KEY`) **no** van en GitHub: `wrangler secret put`.

## Local

```bash
cp .dev.vars.example .dev.vars
npm run cf:prepare
npx wrangler d1 migrations apply exhatech-db --local
npm run cf:dev
```

- Contabilidad: `http://127.0.0.1:8787/contabilidad`
- Bitácora: `http://127.0.0.1:8787/bitacora`
- Health: `http://127.0.0.1:8787/api/health`

Node legacy: `npm start` → `http://localhost:8080/contabilidad`

## Seguridad

- [ ] `data/*.local.json`, `.dev.vars`, claves AES **no** van al repo
- [ ] Secrets solo vía `wrangler secret put` / CI secret store
- [ ] R2 privado; D1 sin HTTP directo
- [ ] Paneles no se publican en Pages (`pages-out` solo marketing)
