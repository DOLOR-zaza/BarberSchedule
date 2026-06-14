/**
 * Estados posibles de una cita.
 * - pendiente:  recién creada, esperando confirmación
 * - confirmada: el barbero la aceptó
 * - atendida:   ya se realizó el servicio
 * - cancelada:  no se llevará a cabo
 */
export type AppointmentStatus = 'pendiente' | 'confirmada' | 'atendida' | 'cancelada';

export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'pendiente',
  'confirmada',
  'atendida',
  'cancelada',
];

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pendiente:  'Pendiente',
  confirmada: 'Confirmada',
  atendida:   'Atendida',
  cancelada:  'Cancelada',
};

export const STATUS_COLORS: Record<AppointmentStatus, { bg: string; text: string; ring: string }> = {
  pendiente:  { bg: 'bg-amber-500/15',  text: 'text-amber-300',  ring: 'ring-amber-500/30'  },
  confirmada: { bg: 'bg-emerald-500/15',text: 'text-emerald-300',ring: 'ring-emerald-500/30'},
  atendida:   { bg: 'bg-sky-500/15',    text: 'text-sky-300',    ring: 'ring-sky-500/30'    },
  cancelada:  { bg: 'bg-rose-500/15',   text: 'text-rose-300',   ring: 'ring-rose-500/30'   },
};
