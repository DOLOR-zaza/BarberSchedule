# Supabase Setup — BarberSchedule V24.0

> **Una sola fuente de verdad** para citas, servicios y barberos.
> json-server queda como herramienta **solo para desarrollo local**.

---

## 🏗️ Arquitectura

```
GitHub Pages (Angular PWA)
        │
        ├────► Supabase (datos reales)
        │       ├── services      (lectura pública)
        │       ├── barbers       (lectura pública)
        │       ├── appointments  (PII, INSERT público, resto denegado)
        │       └── RPC: get_occupied_slots()
        │
        └────► n8n (orquestador)        ← V24.x
                ├── DeepSeek
                ├── Gmail
                └── service_role key (bypasea RLS)
```

**Permisos por rol:**

| Acción            | `anon` (Angular público) | `service_role` (n8n) |
|-------------------|--------------------------|----------------------|
| `SELECT services` | ✅ público               | ✅                    |
| `SELECT barbers`  | ✅ público               | ✅                    |
| `SELECT appts`    | ❌ (PII)                 | ✅                    |
| `INSERT appt`     | ✅ (cliente reserva)     | ✅                    |
| `UPDATE appt`     | ❌                       | ✅                    |
| `DELETE appt`     | ❌                       | ✅                    |
| `get_occupied_slots` | ✅                    | ✅                    |

---

## 📋 Setup en 7 pasos

### 1. Crear proyecto en Supabase

1. Ve a https://supabase.com → **Start your project**
2. **Sign in with GitHub**
3. Click **New project**:
   - **Name**: `barberschedule`
   - **Database password**: genera una segura y anótala
   - **Region**: la más cercana a ti (South America, US West, etc.)
   - **Plan**: Free
4. Click **Create new project**
5. Espera 1-2 minutos a que se aprovisione

### 2. Ejecutar el schema

1. En tu proyecto, ve al menú lateral: **SQL Editor**
2. Click **+ New query**
3. Abre el archivo `supabase/schema.sql` de este repo
4. **Copia todo el contenido** y pégalo en el editor SQL
5. Click **Run** (o `Ctrl/Cmd + Enter`)
6. Espera 5-10 segundos. Debe decir **Success. No rows returned**

### 3. Verificar las tablas

1. Menú lateral: **Table Editor**
2. Debes ver 3 tablas: `services`, `barbers`, `appointments`
3. Click en cada una y verifica que tengan los datos seed:
   - **services**: 6 filas
   - **barbers**: 3 filas
   - **appointments**: 5 filas

### 4. Verificar RLS

1. Menú lateral: **Authentication → Policies**
2. Cada tabla debe tener al menos 1 policy:
   - `services`: `services_public_read`
   - `barbers`: `barbers_public_read`
   - `appointments`: `appointments_anon_insert`

### 5. Verificar la RPC

1. **SQL Editor** → **+ New query**
2. Ejecuta:
   ```sql
   SELECT * FROM get_occupied_slots(1, CURRENT_DATE + 7);
   ```
3. Debe devolver 2 slots: `10:00` y `16:00`

### 6. Obtener las credenciales

1. Menú lateral: **Settings → API**
2. Copia y guarda:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGciOiJIUzI1NiIs...` (largo)
3. ⚠️ **NO copies la `service_role` key** — esa se queda solo para n8n (futuro)

### 7. Verificar el anti-doble-booking

En **SQL Editor**:

```sql
INSERT INTO appointments
  (client_name, phone, email, service_id, barber_id, date, time, status)
  VALUES
  ('Test duplicado', '555', 'test@example.com', 1, 1, CURRENT_DATE + 7, '10:00', 'pendiente');
```

**Esperado**: error `23505: duplicate key value violates unique constraint "uniq_active_appointment"`.

✅ Si da error, la constraint funciona. Las citas duplicadas son imposibles a nivel de DB.

---

## 🧪 Pruebas rápidas (sin Angular aún)

### Como cliente (rol `anon`)

```sql
-- ✅ Esto DEBE funcionar (INSERT público)
INSERT INTO appointments
  (client_name, phone, email, service_id, barber_id, date, time, status)
  VALUES ('Cliente Test', '555-9999', 'cliente@example.com',
          1, 1, CURRENT_DATE + 30, '14:00', 'pendiente');

-- ❌ Esto DEBE FALLAR (SELECT público denegado por RLS)
SELECT client_name, phone, email FROM appointments;
-- Esperado: "permission denied for table appointments"

-- ✅ Esto SÍ funciona (la RPC solo expone time, no PII)
SELECT * FROM get_occupied_slots(1, CURRENT_DATE + 7);
```

### Desde el dashboard de Supabase

El dashboard usa `service_role` (bypasea RLS), así que ahí SÍ puedes ver todos los appointments con PII. Útil para debugging.

---

## ⏭️ Siguiente paso: V24.1 (Angular)

Una vez que V24.0 esté funcionando:

1. `npm install @supabase/supabase-js`
2. Crear `src/environments/environment.prod.ts` con URL + anon key
3. Refactor `AppointmentService` para usar Supabase en producción
4. Mantener `json-server` para `npm start` local

(Lo armamos en V24.1 cuando tú me digas.)

---

## 🔄 Para volver a correr el seed (idempotente)

Si quieres resetear la base de datos, simplemente vuelve a correr `schema.sql` completo en el SQL Editor. Hace DROP al inicio, así que no hay errores de "table already exists".
