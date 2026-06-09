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

**Sitio público:** GitHub Pages (solo HTML/CSS/JS).

**Panel de cobros (vos y tu socio):** solo en cada PC con `npm start` (localhost, sin PHP).

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
# http://localhost:8080  —  panel: http://localhost:8080/eh-mnt.html (5 clics en badge del footer)
```

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
