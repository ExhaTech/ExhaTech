# Worker ExhaTech

Entry: `index.js` → assets (`lib/paths.js`) + API (`api/router.js`).

| Archivo | Rol |
|---------|-----|
| `api/health.js` | `/api/health` |
| `api/contabilidad.js` | Port Contabilidad (pendiente) |
| `api/bitacora.js` | Port Bitácora (pendiente) |
| `lib/http.js` | JSON / CORS |
| `lib/paths.js` | Rewrites `/contabilidad`, `/bitacora`, … |

Deploy: `../docs/DEPLOY-CLOUDFLARE.md`.
