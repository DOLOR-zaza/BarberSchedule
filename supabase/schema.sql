-- =============================================================
-- BarberSchedule V24.0
-- Supabase Schema + RLS + RPC + Seed
-- =============================================================
-- IMPORTANTE:
-- Este script elimina y vuelve a crear las tablas.
-- Es seguro para la instalación inicial / desarrollo,
-- pero NO debe re-ejecutarse cuando ya existan citas reales
-- que quieras conservar.
-- =============================================================

BEGIN;

  -- ============================================================
  -- 1. CLEANUP
  -- ============================================================

  DROP FUNCTION IF EXISTS public.get_occupied_slots
  (BIGINT, DATE) CASCADE;

  DROP TABLE IF EXISTS public.appointments
  CASCADE;
DROP TABLE IF EXISTS public.services
CASCADE;
DROP TABLE IF EXISTS public.barbers
CASCADE;

DROP TYPE IF EXISTS public.appointment_status CASCADE;


-- ============================================================
-- 2. TIPOS
-- ============================================================

CREATE TYPE public.appointment_status AS ENUM
(
  'pendiente',
  'confirmada',
  'atendida',
  'cancelada'
);


-- ============================================================
-- 3. TABLAS
-- ============================================================

-- ------------------------------------------------------------
-- 3.1 SERVICES
-- Catálogo público de servicios
-- ------------------------------------------------------------

CREATE TABLE public.services (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  name TEXT NOT NULL
    CHECK
(length
(trim
(name)) > 0),

  duration INTEGER NOT NULL
    CHECK
(duration > 0),

  price NUMERIC
(10,2) NOT NULL
    CHECK
(price >= 0),

  icon TEXT
);

COMMENT ON TABLE public.services IS
  'Catálogo de servicios de BarberSchedule. Lectura pública.';


-- ------------------------------------------------------------
-- 3.2 BARBERS
-- Catálogo público de barberos
-- ------------------------------------------------------------

CREATE TABLE public.barbers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  name TEXT NOT NULL
    CHECK
(length
(trim
(name)) > 0),

  specialty TEXT,

  available BOOLEAN NOT NULL DEFAULT true,

  avatar TEXT,

  experience INTEGER NOT NULL DEFAULT 0
    CHECK
(experience >= 0)
);

COMMENT ON TABLE public.barbers IS
  'Equipo de barberos de BarberSchedule. Lectura pública.';


-- ------------------------------------------------------------
-- 3.3 APPOINTMENTS
-- Tabla privada: contiene PII
-- ------------------------------------------------------------

CREATE TABLE public.appointments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  client_name TEXT NOT NULL
    CHECK
(length
(trim
(client_name)) > 0),

  phone TEXT NOT NULL
    CHECK
(length
(trim
(phone)) > 0),

  email TEXT NOT NULL
    CHECK
(length
(trim
(email)) > 0),

  service_id BIGINT NOT NULL
    REFERENCES public.services
(id)
    ON
UPDATE CASCADE
    ON
DELETE RESTRICT,

  barber_id BIGINT
NOT NULL
    REFERENCES public.barbers
(id)
    ON
UPDATE CASCADE
    ON
DELETE RESTRICT,

  date DATE
NOT NULL,

  time TIME NOT NULL,

  status public.appointment_status
    NOT NULL
    DEFAULT 'pendiente',

  notes TEXT NOT NULL DEFAULT '',

  created_at TIMESTAMPTZ
    NOT NULL
    DEFAULT NOW
()
);

COMMENT ON TABLE public.appointments IS
  'Citas de BarberSchedule. Contiene PII: nombre, teléfono y email. '
  'No existe lectura pública de esta tabla.';


-- ============================================================
-- 4. ÍNDICES
-- ============================================================

CREATE INDEX idx_appointments_barber_date
  ON public.appointments (barber_id, date);

CREATE INDEX idx_appointments_date
  ON public.appointments (date);

CREATE INDEX idx_appointments_status
  ON public.appointments (status);


-- ------------------------------------------------------------
-- 4.1 ANTI-DOBLE-BOOKING
-- ------------------------------------------------------------
-- Impide dos citas activas para:
-- mismo barbero + misma fecha + misma hora.
--
-- Una cita cancelada libera nuevamente el horario.
-- ------------------------------------------------------------

CREATE UNIQUE INDEX uniq_active_appointment
  ON public.appointments (barber_id, date, time)
  WHERE status <> 'cancelada'
::public.appointment_status;

COMMENT ON INDEX public.uniq_active_appointment IS
  'Previene doble reservación activa del mismo barbero, fecha y hora.';


-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.services
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.barbers
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.appointments
  ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 6. PRIVILEGIOS DE TABLAS
-- ============================================================
-- Quitamos permisos implícitos y concedemos solamente
-- lo necesario para la aplicación pública.
-- ============================================================

REVOKE ALL
  ON TABLE public.services
  FROM anon, authenticated;

REVOKE ALL
  ON TABLE public.barbers
  FROM anon, authenticated;

REVOKE ALL
  ON TABLE public.appointments
  FROM anon, authenticated;


-- Services: solo lectura pública

GRANT SELECT
  ON TABLE public.services
  TO anon, authenticated;


-- Barbers: solo lectura pública

GRANT SELECT
  ON TABLE public.barbers
  TO anon, authenticated;


-- Appointments:
-- El cliente puede crear una cita,
-- pero NO leer todas las citas,
-- NO actualizar y NO eliminar.

GRANT INSERT (
  client_name,
  phone,
  email,
  service_id,
  barber_id,
  date,
  time,
  status,
  notes
)
ON TABLE public.appointments
TO anon, authenticated;


-- Permite que PostgreSQL genere automáticamente
-- el BIGINT identity de appointments.

GRANT USAGE
  ON SEQUENCE public.appointments_id_seq
  TO anon, authenticated;


-- ============================================================
-- 7. POLICIES RLS
-- ============================================================

-- ------------------------------------------------------------
-- 7.1 SERVICES
-- ------------------------------------------------------------

CREATE POLICY "services_public_read"
ON public.services
FOR
SELECT
  TO anon, authenticated
USING
(true);


-- ------------------------------------------------------------
-- 7.2 BARBERS
-- ------------------------------------------------------------

CREATE POLICY "barbers_public_read"
ON public.barbers
FOR
SELECT
  TO anon, authenticated
USING
(true);


-- ------------------------------------------------------------
-- 7.3 APPOINTMENTS
-- ------------------------------------------------------------
-- Se permite crear citas únicamente:
--
-- 1. Con status pendiente.
-- 2. Para hoy o una fecha futura.
--
-- No existe policy SELECT para anon/authenticated,
-- por lo tanto la PII no puede consultarse públicamente.
--
-- Tampoco existen policies UPDATE o DELETE.
-- ------------------------------------------------------------

CREATE POLICY "appointments_public_insert"
ON public.appointments
FOR
INSERT
TO
anon,
authenticated
WITH CHECK
(
  status = 'pendiente'::public.appointment_status
  AND date >= CURRENT_DATE
);


-- ============================================================
-- 8. RPC: GET OCCUPIED SLOTS
-- ============================================================
-- Esta función permite consultar los horarios ocupados
-- sin entregar nombres, emails, teléfonos ni otras PII.
--
-- Angular podrá preguntar:
--
-- barber 1 + 2026-08-20
--
-- y recibir únicamente:
--
-- 10:00
-- 11:30
-- 16:00
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_occupied_slots
(
  p_barber_id BIGINT,
  p_date DATE
)
RETURNS TABLE
(
  time_slot TIME
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path
= ''
AS $$
SELECT a.time AS time_slot
FROM public.appointments AS a
WHERE a.barber_id = p_barber_id
  AND a.date = p_date
  AND a.status <> 'cancelada'
::public.appointment_status
  ORDER BY a.time;
$$;


COMMENT ON FUNCTION public.get_occupied_slots
(BIGINT, DATE) IS
  'Devuelve horarios ocupados para un barbero y fecha sin exponer PII.';


-- Las funciones pueden tener permiso EXECUTE para PUBLIC
-- por defecto. Lo eliminamos explícitamente.

REVOKE EXECUTE
ON FUNCTION public.get_occupied_slots
(BIGINT, DATE)
FROM PUBLIC;


-- Angular podrá usar esta RPC con la publishable key.

GRANT EXECUTE
ON FUNCTION public.get_occupied_slots
(BIGINT, DATE)
TO anon, authenticated;


-- ============================================================
-- 9. SEED DATA
-- ============================================================

-- ------------------------------------------------------------
-- 9.1 SERVICES
-- ------------------------------------------------------------

INSERT INTO public.services
  (
  name,
  duration,
  price,
  icon
  )
VALUES
  ('Corte clásico', 30, 120.00, '✂️'),
  ('Corte degradado', 45, 180.00, '💈'),
  ('Barba', 30, 100.00, '🪒'),
  ('Corte + barba', 60, 250.00, '💇'),
  ('Tinte', 60, 280.00, '🎨'),
  ('Diseño', 45, 200.00, '⚡');


-- ------------------------------------------------------------
-- 9.2 BARBERS
-- ------------------------------------------------------------

INSERT INTO public.barbers
  (
  name,
  specialty,
  available,
  avatar,
  experience
  )
VALUES
  (
    'Carlos Méndez',
    'Degradados y diseños',
    true,
    '🧔',
    8
  ),
  (
    'Luis Rodríguez',
    'Corte clásico y barba',
    true,
    '👨‍🦱',
    5
  ),
  (
    'Andrés Vega',
    'Tinte y color',
    true,
    '👨',
    3
  );


-- ------------------------------------------------------------
-- 9.3 APPOINTMENTS
-- ------------------------------------------------------------
--
-- 5 citas de prueba:
--
-- 3 futuras activas
-- 1 atendida en el pasado
-- 1 cancelada futura
-- ------------------------------------------------------------

INSERT INTO public.appointments
  (
  client_name,
  phone,
  email,
  service_id,
  barber_id,
  date,
  time,
  status,
  notes
  )
VALUES

  (
    'Juan Pérez',
    '555-0101',
    'juan.perez@example.com',
    1,
    1,
    CURRENT_DATE + 7,
    TIME
'10:00',
    'confirmada',
    'Cliente regular, prefiere corte bajo en los lados'
  ),

(
    'María López',
    '555-0202',
    'maria.lopez@example.com',
    3,
    2,
    CURRENT_DATE + 7,
    TIME '11:30',
    'pendiente',
    ''
  ),

(
    'Carlos Ruiz',
    '555-0303',
    'carlos.ruiz@example.com',
    2,
    1,
    CURRENT_DATE + 7,
    TIME '16:00',
    'confirmada',
    'Degradado alto'
  ),

(
    'Ana Torres',
    '555-0404',
    'ana.torres@example.com',
    4,
    3,
    CURRENT_DATE - 2,
    TIME '12:00',
    'atendida',
    ''
  ),

(
    'Pedro Sánchez',
    '555-0505',
    'pedro.sanchez@example.com',
    5,
    2,
    CURRENT_DATE + 8,
    TIME '15:30',
    'cancelada',
    'Cliente canceló por viaje'
  );


COMMIT;


-- ============================================================
-- 10. VERIFICACIÓN
-- ============================================================
-- Estas consultas están comentadas intencionalmente.
-- Ejecútalas DESPUÉS de crear el schema.
-- ============================================================


-- ------------------------------------------------------------
-- 10.1 Cantidad de registros
-- ------------------------------------------------------------

-- SELECT COUNT(*) AS total_services
-- FROM public.services;
-- Esperado: 6


-- SELECT COUNT(*) AS total_barbers
-- FROM public.barbers;
-- Esperado: 3


-- SELECT COUNT(*) AS total_appointments
-- FROM public.appointments;
-- Esperado: 5


-- ------------------------------------------------------------
-- 10.2 Horarios ocupados del barbero 1
-- ------------------------------------------------------------

-- SELECT *
-- FROM public.get_occupied_slots(
--   1,
--   CURRENT_DATE + 7
-- );

-- Esperado:
-- 10:00:00
-- 16:00:00


-- ------------------------------------------------------------
-- 10.3 Horarios ocupados del barbero 2
-- ------------------------------------------------------------

-- SELECT *
-- FROM public.get_occupied_slots(
--   2,
--   CURRENT_DATE + 7
-- );

-- Esperado:
-- 11:30:00


-- ------------------------------------------------------------
-- 10.4 TEST ANTI-DOBLE-BOOKING
-- ------------------------------------------------------------
-- Esta consulta DEBE FALLAR.
--
-- Esperado:
-- ERROR 23505
-- duplicate key value violates unique constraint
-- "uniq_active_appointment"
-- ------------------------------------------------------------

-- INSERT INTO public.appointments (
--   client_name,
--   phone,
--   email,
--   service_id,
--   barber_id,
--   date,
--   time,
--   status
-- )
-- VALUES (
--   'Test duplicado',
--   '555',
--   'test@example.com',
--   1,
--   1,
--   CURRENT_DATE + 7,
--   TIME '10:00',
--   'pendiente'
-- );
