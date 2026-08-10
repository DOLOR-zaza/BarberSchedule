import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Appointment, AppointmentDraft, AppointmentStatus } from '../models';
import { N8nService } from './n8n.service';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';

const API_URL = 'http://127.0.0.1:3001/appointments';

/**
 * Servicio central de citas. Usa HttpClient contra json-server
 * y expone la lista como Signal para integración directa con
 * componentes standalone.
 *
 * Incluye la regla de negocio clave: validación de horario
 * ocupado para evitar doble reserva al mismo barbero.
 */
@Injectable({ providedIn: 'root' })
export class AppointmentService {
  private http = inject(HttpClient);
  private n8n  = inject(N8nService);
  private supabase = inject(SupabaseService);

  /** Fuente de verdad reactiva (modo local). */
  private readonly _appointments = signal<Appointment[]>([]);
  readonly appointments = this._appointments.asReadonly();

  /** Estado de carga, útil para skeletons. */
  readonly loading = signal<boolean>(false);
  readonly error   = signal<string | null>(null);

  /**
   * Disponibilidad consultada. En producción (Supabase) la llena
   * `loadOccupiedSlots()` desde el RPC `get_occupied_slots`. En dev
   * la llena `loadAll()` desde json-server y `occupiedSlots()`
   * filtra del signal local.
   *
   * Mantenido como signal para que `occupiedSlots()` siga
   * teniendo una interfaz síncrona para el componente.
   */
  readonly occupiedSlotsByBarberDate = signal<string[]>([]);
  readonly availabilityLoading = signal<boolean>(false);
  readonly availabilityError   = signal<string | null>(null);
  private _epoch = 0;

  // --- Selectores derivados (computed signals) ---
  readonly count = computed(() => this._appointments().length);

  readonly todayCount = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return this._appointments().filter((a) => a.date === today).length;
  });

  readonly countsByStatus = computed(() => {
    const acc: Record<AppointmentStatus, number> = {
      pendiente: 0, confirmada: 0, atendida: 0, cancelada: 0,
    };
    for (const a of this._appointments()) acc[a.status]++;
    return acc;
  });

  // --- CRUD ---
  async loadAll(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await firstValueFrom(this.http.get<Appointment[]>(API_URL));
      this._appointments.set(data);
    } catch (e) {
      this.error.set('No se pudieron cargar las citas. ¿json-server está corriendo?');
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  async create(draft: AppointmentDraft): Promise<Appointment | null> {
    if (this.hasConflict(draft)) {
      this.error.set('Ese barbero ya tiene una cita en ese horario.');
      return null;
    }
    try {
      const created = await firstValueFrom(
        this.http.post<Appointment>(API_URL, draft),
      );
      this._appointments.update((list) => [...list, created]);
      // Notificación vía n8n (fire-and-forget, no bloquea).
      this.n8n.notify('created', created, { triggeredBy: 'client' });
      return created;
    } catch (e) {
      this.error.set('No se pudo crear la cita.');
      console.error(e);
      return null;
    }
  }

  async update(id: number, patch: Partial<AppointmentDraft>): Promise<Appointment | null> {
    const previous = this._appointments().find((a) => a.id === id);
    if (patch.barberId || patch.date || patch.time) {
      if (!previous) return null;
      const merged = { ...previous, ...patch } as AppointmentDraft;
      if (this.hasConflict(merged, id)) {
        this.error.set('Ese barbero ya tiene una cita en ese horario.');
        return null;
      }
    }
    try {
      const updated = await firstValueFrom(
        this.http.patch<Appointment>(`${API_URL}/${id}`, patch),
      );
      this._appointments.update((list) => list.map((a) => (a.id === id ? updated : a)));
      const event =
        updated.status === 'confirmada' ? 'confirmed' :
        updated.status === 'atendida'   ? 'attended'   :
        updated.status === 'cancelada'  ? 'cancelled'  :
        'updated';
      this.n8n.notify(event, updated, {
        triggeredBy: 'admin',
        previousStatus: previous?.status,
      });
      return updated;
    } catch (e) {
      this.error.set('No se pudo actualizar la cita.');
      console.error(e);
      return null;
    }
  }

  async changeStatus(id: number, status: AppointmentStatus): Promise<void> {
    await this.update(id, { status });
  }

  async remove(id: number): Promise<void> {
    try {
      // Capturamos la cita antes de borrar para poder notificar.
      const removed = this._appointments().find((a) => a.id === id);
      await firstValueFrom(this.http.delete(`${API_URL}/${id}`));
      this._appointments.update((list) => list.filter((a) => a.id !== id));
      if (removed) this.n8n.notify('deleted', removed, { triggeredBy: 'admin' });
    } catch (e) {
      this.error.set('No se pudo eliminar la cita.');
      console.error(e);
    }
  }

  // --- Regla de negocio: validación de horario ocupado ---
  /**
   * Devuelve true si el barbero ya tiene una cita que se cruza
   * con el rango [time, time + duración del servicio].
   * Por ahora se valida solapamiento simple (mismo slot de 30 min)
   * porque los servicios duran múltiplos de 30.
   */
  hasConflict(draft: AppointmentDraft, ignoreId?: number): boolean {
    const start = this.toMinutes(draft.time);
    return this._appointments().some((a) => {
      if (a.id === ignoreId) return false;
      if (a.barberId !== draft.barberId) return false;
      if (a.date    !== draft.date)    return false;
      if (a.status  === 'cancelada')   return false;
      return this.toMinutes(a.time) === start;
    });
  }

  /**
   * Devuelve los slots ya ocupados para un barbero+fecha.
   *
   * Modo dev (json-server): filtra del signal local `_appointments`.
   * Modo prod (Supabase): lee del signal `occupiedSlotsByBarberDate`,
   *   que se llena con `loadOccupiedSlots()` (vía RPC).
   *
   * El componente sigue recibiendo `string[]` síncrono.
   */
  occupiedSlots(barberId: number, date: string): string[] {
    if (environment.useSupabase) {
      return this.occupiedSlotsByBarberDate();
    }
    return this._appointments()
      .filter((a) => a.barberId === barberId && a.date === date && a.status !== 'cancelada')
      .map((a) => a.time);
  }

  /**
   * Carga slots ocupados para un barbero+fecha desde el RPC
   * `get_occupied_slots` de Supabase. En dev no hace nada.
   *
   * Fail-closed con epoch counter: si el usuario cambia barbero/fecha
   * mientras hay una RPC en vuelo, las respuestas viejas se descartan
   * y solo la última llamada actualiza el signal.
   */
  async loadOccupiedSlots(barberId: number, date: string): Promise<void> {
    if (!environment.useSupabase) return;
    const myEpoch = ++this._epoch;
    // Limpiar slots anteriores inmediatamente (evita parpadeo).
    this.occupiedSlotsByBarberDate.set([]);
    this.availabilityLoading.set(true);
    this.availabilityError.set(null);
    try {
      const { data, error } = await this.supabase.client
        .rpc('get_occupied_slots', {
          p_barber_id: barberId,
          p_date: date,
        });
      // Si llegó una llamada más reciente, descartar esta respuesta.
      if (myEpoch !== this._epoch) return;
      if (error) throw error;
      // Normalizar HH:mm:ss → HH:mm
      const slots = (data ?? [])
        .map((row: { time_slot: string }) => row.time_slot)
        .map((t: string) => t.slice(0, 5));
      this.occupiedSlotsByBarberDate.set(slots);
    } catch (e) {
      if (myEpoch !== this._epoch) return;
      // Detalles internos solo en consola; UI muestra mensaje genérico.
      console.error('Error consultando disponibilidad', e);
      this.availabilityError.set('No se pudo consultar la disponibilidad');
    } finally {
      if (myEpoch === this._epoch) {
        this.availabilityLoading.set(false);
      }
    }
  }

  /**
   * Limpia el estado de disponibilidad. Usado cuando barbero/fecha
   * quedan vacíos. También incrementa `_epoch` para invalidar
   * cualquier RPC pendiente, de modo que una respuesta tardía
   * no pueda escribir sobre el estado limpio.
   */
  resetOccupiedSlots(): void {
    this._epoch++;
    this.occupiedSlotsByBarberDate.set([]);
    this.availabilityLoading.set(false);
    this.availabilityError.set(null);
  }

  private toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }
}
