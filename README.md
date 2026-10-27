# Exha Technologies — Sitio Web

Sitio web profesional para **Exha Technologies** construido con HTML, CSS y JavaScript puros. Sin dependencias ni proceso de build.

> _Simplificamos tus necesidades._

## 🎨 Identidad de marca aplicada

| Elemento | Valor |
|---|---|
| Cian galante | `#197278` |
| Terracota intenso | `#C44536` |
| Marfil antiguo | `#F4EBD9` |
| Tipografía | **Outfit** (alternativa libre a *Garet*) |

## 📁 Estructura

```
ExhaTech/
├── index.html
├── styles.css
├── script.js
├── assets/
│   ├── logo.png
│   ├── illustration-1.png
│   └── illustration-2.png
└── README.md
```

## 🧩 Secciones

1. Hero
2. Nosotros
3. Servicios (6 tarjetas)
4. Proceso (4 pasos)
5. ¿Por qué Exha?
6. CTA banner
7. Contacto (con formulario validado)
8. Footer

## 🚀 Cómo verlo

**Sitio + Contabilidad + Bitácora (Cloudflare Workers):** ver [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md).

```bash
npm install
npm run cf:prepare   # arma ./public
npm run cf:dev       # local Workers (API aún parcial)
# producción: npm run cf:deploy  (DevOps)
```

**Local legacy (Node + JSON en disco):**

```bash
npm start
# http://localhost:8080/contabilidad
# http://localhost:8080/bitacora
```

**Sitio público histórico:** GitHub Pages (solo HTML/CSS/JS) — migrar apex al Worker.

**Panel de cobros (legacy):** solo en cada PC con `npm start` (localhost).

### Sincronizar los dos (mismo archivo de cobros)

1. `data/cobros.json` → **sí va a Git**, va **cifrado** (nadie lee clientes/montos sin la clave).
2. `data/auth.local.json` → **no va a Git** (solo en cada máquina, misma contraseña acordada entre ustedes).
3. Flujo: uno guarda → `git add data/cobros.json` → `commit` → `push` → el otro `git pull` → `npm start` → entra con la misma clave.

Primera vez en cada PC:

```bash
copy data\auth.local.example.json data\auth.local.json
# Editá auth.local.json con admin@exhatech.com y tu contraseña
npm start
```

```bash
# http://localhost:8080
# Contabilidad → http://localhost:8080/contabilidad
# Bitácora → http://localhost:8080/bitacora
```

**Bitácora:** seguimiento para administración de condominios (captura → tablero kanban). Página **Mantenimientos**: Condominios, Orígenes y Contactos. Las tareas admiten uno o más contactos. Mismo login que Contabilidad; datos en `data/foco/` (locales, no van a Git).

## 📞 Contacto (placeholders)

- **Email:** email@example.com
- **Teléfono:** +123456789

Reemplaza estos valores en `index.html` cuando tengas los datos reales.

## ✅ Características técnicas

- 100% responsivo (móvil, tablet, escritorio)
- Navegación móvil con hamburguesa
- Animaciones de aparición al hacer scroll
- Formulario con validación frontend
- Accesibilidad básica
- Sin dependencias, sin build step
