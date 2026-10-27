# Deploy ExhaTech en Cloudflare Workers (DevOps)

Un solo Worker sirve:

| Ruta | Qué es |
|------|--------|
| `/` | Sitio marketing |
| `/contabilidad` | Módulo Contabilidad (UI) |
| `/bitacora` | Módulo Bitácora (UI) |
| `/api/health` | Healthcheck |
| `/api/eh-data` | API Contabilidad en Workers |
| `/api/foco` | API Bitácora en Workers |

Datos sensibles: **D1** (usuarios/sesiones) + **R2** (JSON por usuario, cifrado con secret).  
Credenciales: **Wrangler Secrets**, nunca en Git ni en `wrangler.jsonc`.

`DATA_ENCRYPTION_KEY` cumple el mismo rol que `data/budget.master.local` en Node local: sin la misma llave no se pueden leer los presupuestos cifrados.

## Prerrequisitos

- Node 20+
- Cuenta Cloudflare + dominio (ej. `exhatech.com`)
- `npx wrangler login` (o API token en CI: `CLOUDFLARE_API_TOKEN`)

## Primera vez (cuenta)

```bash
cd ExhaTech
npm install

# 1) Assets estáticos
npm run cf:prepare

# 2) Base D1
npx wrangler d1 create exhatech-db
# Pegar el database_id en wrangler.jsonc → d1_databases[0].database_id

# 3) Bucket R2
npx wrangler r2 bucket create exhatech-data

# 4) Migraciones
npx wrangler d1 migrations apply exhatech-db --remote

# 5) Secrets (interactivo; no loguear valores)
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DATA_ENCRYPTION_KEY
# opcional: primer admin automático si D1 arranca vacío
npx wrangler secret put SEED_ADMIN_PASSWORD
```

## Migración de usuarios, presupuestos y Bitácora

- Usuarios Node viven en `data/users.local.json`; migrarlos a D1 antes del corte.
- Presupuestos Node viven en `data/budgets/*.json`; migrarlos a R2 conservando la misma llave maestra.
- Bitácora Node vive en `data/foco/*.json`; migrarla a R2 usando objetos `foco/{userId}.json`.
- Los blobs de Bitácora también deben quedar cifrados con `DATA_ENCRYPTION_KEY` porque contienen PII.
- Para crear un `INSERT` compatible de un usuario admin:

```bash
node scripts/cf-seed-admin.mjs --username admin --password TU_CLAVE > seed-admin.sql
npx wrangler d1 execute exhatech-db --remote --file seed-admin.sql
```

- Si preferís seed automático solo para el primer arranque, definí `SEED_ADMIN_PASSWORD` y hacé el primer login con `admin`.

## Deploy

```bash
npm run cf:prepare
npm run cf:deploy
```

Dry-run (empaquetado sin publicar):

```bash
npm run cf:deploy:dry
```

## Dominio custom

En Dashboard → Workers → `exhatech` → Settings → Domains:

- Agregar `exhatech.com` y `www.exhatech.com` (o el hostname acordado).
- DNS: registros proxied (naranja) apuntando al Worker.

Si hoy el sitio está en GitHub Pages / otro origen, cortar ese origin al migrar el apex al Worker para no servir dos stacks.

## Local (Workers)

```bash
cp .dev.vars.example .dev.vars
# editar secrets locales
npm run cf:prepare
npx wrangler d1 migrations apply exhatech-db --local
npm run cf:dev
```

Health: `http://127.0.0.1:8787/api/health`

Contabilidad Worker: `http://127.0.0.1:8787/contabilidad`  
Bitácora Worker: `http://127.0.0.1:8787/bitacora`

## Local (Node legacy)

Sigue disponible para compatibilidad local:

```bash
npm start
# http://localhost:8080/contabilidad
# http://localhost:8080/bitacora
```

## Seguridad (checklist)

- [ ] `data/*.local.json`, `.dev.vars`, claves AES **no** están en el repo
- [ ] Secrets solo vía `wrangler secret put` / CI secret store
- [ ] R2 bucket privado (sin acceso público)
- [ ] D1 sin exposición HTTP directa
- [ ] `/api/health` no revela valores de secrets (solo booleans)
- [ ] Tras migrar APIs: rotar `SESSION_SECRET` si hubo leak previo

## Estructura de código

```
worker/
  index.js           # entry fetch
  api/router.js      # /api/*
  api/health.js
  lib/http.js
  lib/paths.js       # /contabilidad → eh-mnt.html, etc.
migrations/          # D1
scripts/prepare-cf-assets.mjs
public/              # generado (no editar a mano)
wrangler.jsonc
```

## Estado actual

1. Auth + Contabilidad ya viven en Workers con D1/R2  
2. Bitácora ya vive en Workers y guarda en R2 bajo `foco/{userId}.json`  
3. `server.js` / `npm start` se mantienen para desarrollo local y compatibilidad
