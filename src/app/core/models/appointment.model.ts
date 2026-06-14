import { AppointmentStatus } from './appointment-status.model';

/**
 * Cita agendada. Contiene referencias a servicio y barbero por id
 * para mantener la entidad ligera en json-server.
 * El cliente siempre trae nombre y teléfono (sin auth).
 */
export interface Appointment {
  id: number;
  clientName: string;
  phone: string;
  serviceId: number;
  barberId: number;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm en formato 24h */
  time: string;
  status: AppointmentStatus;
  notes: string;
}

/**
 * Payload para crear/editar una cita.
 * El id lo asigna json-server al crear.
 */
export type AppointmentDraft = Omit<Appointment, 'id'>;
