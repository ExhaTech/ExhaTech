# Llave del presupuesto (NO commitear la llave)

## Qué va a Git
- `data/budgets/*.json` → **sí**, van **cifrados** (AES-256-GCM). Son el respaldo.
- `data/budget.master.local` → **nunca**.
- `data/users.local.json` → **nunca** (hashes de login).

## Dónde está la llave en tu PC
Archivo: `data/budget.master.local`  
Es un string hex (64 caracteres). Sin ese valor, los JSON de `budgets/` no se pueden descifrar.

## Cloudflare / producción
Definí el secreto (no lo pongas en el repo):

```
BUDGET_MASTER_KEY=<contenido de data/budget.master.local>
```

El server lee primero `BUDGET_MASTER_KEY` y, si no hay, el archivo local.

## Respaldo obligatorio
Copiá `budget.master.local` a un lugar seguro (password manager / USB).  
Si perdés la llave, perdés los datos aunque tengas los JSON en Git.
