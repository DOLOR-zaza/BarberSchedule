import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Appointment, AppointmentDraft, AppointmentStatus } from '../models';

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

  /** Fuente de verdad reactiva. */
  private readonly _appointments = signal<Appointment[]>([]);
  readonly appointments = this._appointments.asReadonly();

  /** Estado de carga, útil para skeletons. */
  readonly loading = signal<boolean>(false);
  readonly error   = signal<string | null>(null);

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
      return created;
    } catch (e) {
      this.error.set('No se pudo crear la cita.');
      console.error(e);
      return null;
    }
  }

  async update(id: number, patch: Partial<AppointmentDraft>): Promise<Appointment | null> {
    if (patch.barberId || patch.date || patch.time) {
      const current = this._appointments().find((a) => a.id === id);
      if (!current) return null;
      const merged = { ...current, ...patch } as AppointmentDraft;
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
      await firstValueFrom(this.http.delete(`${API_URL}/${id}`));
      this._appointments.update((list) => list.filter((a) => a.id !== id));
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

  /** Devuelve los slots ya ocupados para un barbero+fecha. */
  occupiedSlots(barberId: number, date: string): string[] {
    return this._appointments()
      .filter((a) => a.barberId === barberId && a.date === date && a.status !== 'cancelada')
      .map((a) => a.time);
  }

  private toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }
}
