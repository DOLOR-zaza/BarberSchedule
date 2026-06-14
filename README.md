# 💈 BarberSchedule

> Sistema de gestión de citas para una barbería — hecho con **Angular 21**, **Tailwind v4** y un **barber pole 3D ** generado proceduralmente con Three.js.

![Angular](https://img.shields.io/badge/Angular-21.2-DD0031?logo=angular&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38B2AC?logo=tailwindcss&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-latest-000000?logo=three.js&logoColor=white)

Aplicación de agenda para barbería, con un hero 3D que renderiza un poste de barbería con **illusion effect real** (las franjas se ven subiendo) sin usar imágenes externas — todo se genera en un `<canvas>` con `ImageData` y se anima cada frame.

---

## ✨ Características

### 🏠 **Inicio**

- Hero 3D con barber pole animado proceduralmente (Canvas2D + Three.js)
- Estadísticas con contadores animados
- Próximas 3 citas
- Acciones rápidas

### 📅 **Citas**

- Lista con filtros por estado y búsqueda debounced
- Confirmación antes de eliminar
- Acciones inline: confirmar, atender, cancelar
- 3-step stepper para crear/editar
- Validación de conflictos de horario
- Soporte de `?service=N` y `?barber=N` en URL

### ✂️ **Servicios**

- Tarjetas con efecto 3D flip
- Vista de detalle por servicio
- Búsqueda y filtros

### 💈 **Barberos**

- Cards con efecto tilt
- Vista por barbero con sus servicios y citas
- Búsqueda por especialidad

### 🤖 **Asistente (BarberBot)**

- 32+ intents rule-based
- Detección fuzzy de servicios (longest match wins)
- 41 quick replies contextuales
- Burbujas animadas
- Indicador de typing
- Cero IA externa (todo local)

### 🛠️ **Extras**

- Error boundary global con UI
- Skip link para lectores de pantalla
- `prefers-reduced-motion` respetado
- View Transitions API
- `@defer` para lazy-load del 3D

---

## 🛠 Stack técnico

| Capa             | Tecnología                                                |
| ---------------- | --------------------------------------------------------- |
| **Framework**    | Angular 21.2.8 (standalone components, signals, zoneless) |
| **Estilos**      | Tailwind CSS v4 (nueva sintaxis `bg-X/N`)                 |
| **3D**           | Three.js (sin librerías de abstracción)                   |
| **Animaciones**  | GSAP + CSS nativas                                        |
| **Formularios**  | Reactive Forms + `toSignal()` para reactividad            |
| **HTTP**         | `provideHttpClient` con `fetch`                           |
| **Backend mock** | json-server 1.0.0-beta.3                                  |
| **TypeScript**   | 5.9                                                       |
| **Node**         | 18+                                                       |

---

## 🚀 Setup en 3 pasos

### 1. Instalar dependencias

```bash
npm install
```

### 2. Levantar json-server (en otra terminal)

```bash
npm run server
```

Crea un servidor REST en `http://localhost:3000` con los datos de `db.json`.

### 3. Levantar Angular

```bash
npm start
```

Abre `http://localhost:4200`.

> **Tip:** `Ctrl+Shift+R` para hard refresh si la cache te miente.

---

## 📁 Estructura

```
BarberSchedule/
├── src/
│   ├── app/
│   │   ├── core/              # Modelos, tipos, error handler
│   │   ├── features/          # Páginas (home, citas, servicios, etc.)
│   │   ├── layout/            # MainLayout con navbar
│   │   ├── shared/            # Componentes, directivas, services
│   │   │   ├── components/    # ErrorBoundary, Skeleton, Hero3d, etc.
│   │   │   └── services/      # Appointment, Barber, Service, Chatbot
│   │   ├── app.config.ts      # Configuración (router, http, error)
│   │   └── app.routes.ts      # Rutas con lazy loading
│   ├── styles.css            # Tailwind v4 + design tokens + a11y
│   └── main.ts
├── db.json                    # Datos seed para json-server
├── angular.json
├── package.json
└── README.md
```

---

## 🎨 Sistema de diseño

### Colores (brand)

```css
--color-brand-300: #f5b942 --color-brand-400: #fcd34d --color-brand-500: #fbbf24;
```

### Tipografía

- **Display:** `Bebas Neue` (headings)
- **Body:** `Inter` (texto)

### Espaciado

- Basado en rem con escala 4-8-12-16-24-32-48-64

---

## 🧠 La magia del hero 3D

El barber pole **no usa imágenes**. Todo se genera proceduralmente:

```typescript
let phase = v * turns - u + time * speed;
phase = phase - Math.floor(phase);
const bandIdx = Math.floor(phase * bands);
```

Donde:

- `u = x / W` (normalizada horizontal)
- `v = y / H` (normalizada vertical)
- `turns = 4` (vueltas verticales)
- `bands = 4` (R, W, B, W)
- `time * speed = 0.32` (animación)

Más sombreado cilíndrico baked en la textura (edge shadow + highlight Gaussiano) para que las franjas se vean curvadas.

**Resultado:** las franjas aparentan **subir** por el cilindro, aunque la geometría **no rota** — el cerebro lo interpreta como rotación.

---

## 📜 Scripts

```bash
npm start           # ng serve (dev server)
npm run server      # json-server en :3000
npm run build       # build de producción
npm run watch       # build watch
```

---

## ♿ Accesibilidad

- ✅ Skip-to-main-content link
- ✅ `aria-label` en todos los botones iconos
- ✅ `role="alert"` y `aria-live` en notificaciones
- ✅ Focus visible global con outline brand
- ✅ `prefers-reduced-motion` respetado
- ✅ Contraste WCAG AA
- ✅ `<main id="main-content" tabindex="-1">` con skip target

---

## 📊 Performance

- **Initial bundle:** ~105 kB transfer (gzip)
- **Lazy chunks:** home (Three.js 138kB), rutas (1-15kB cada una)
- **Hero 3D:** lazy con `@defer (on viewport; prefetch on idle)`
- **Zoneless change detection:** reduce re-renders
- **Signals:** reactividad fina, no zone-based

---
