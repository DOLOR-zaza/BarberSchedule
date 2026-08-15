import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Appointment, AppointmentDraft, AppointmentStatus } from '../models';
import { N8nService } from './n8n.service';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';

const API_URL = 'http://127.0.0.1:3001/appointments';

type SupabaseAppointmentRow = {
  id: number;
  client_name: string;
  phone: string;
  email: string;
  service_id: number;
  barber_id: number;
  date: string;
  time: string;
  status: AppointmentStatus;
  notes: string | null;
};

const ADMIN_SELECT =
  'id,client_name,phone,email,service_id,barber_id,date,time,status,notes';

@Injectable({ providedIn: 'root' })
export class AppointmentService {
  private http = inject(HttpClient);
  private n8n = inject(N8nService);
  private supabase = inject(SupabaseService);

  private readonly _appointments = signal<Appointment[]>([]);
  readonly appointments = this._appointments.asReadonly();

  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly occupiedSlotsByBarberDate = signal<string[]>([]);
  readonly availabilityLoading = signal<boolean>(false);
  readonly availabilityError = signal<string | null>(null);
  private _epoch = 0;

  readonly count = computed(() => this._appointments().length);

  readonly todayCount = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return this._appointments().filter((a) => a.date === today).length;
  });

  readonly countsByStatus = computed(() => {
    const acc: Record<AppointmentStatus, number> = {
      pendiente: 0,
      confirmada: 0,
      atendida: 0,
      cancelada: 0,
    };

    for (const a of this._appointments()) {
      acc[a.status]++;
    }

    return acc;
  });

  // ─────────────────────────────────────────────────────────
  // READ
  // ─────────────────────────────────────────────────────────

  async loadAll(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      if (environment.useSupabase) {
        await this.loadAllFromSupabase();
      } else {
        await this.loadAllFromJsonServer();
      }
    } finally {
      this.loading.set(false);
    }
  }

  private async loadAllFromJsonServer(): Promise<void> {
    try {
      const data = await firstValueFrom(
        this.http.get<Appointment[]>(API_URL),
      );

      this._appointments.set(data);
    } catch (e) {
      this._appointments.set([]);
      this.error.set(
        'No se pudieron cargar las citas. ¿json-server está corriendo?',
      );
      console.error(e);
    }
  }

  /**
   * V25.2:
   * SELECT administrativo desde Supabase.
   *
   * Esta llamada solo funciona con una sesión autenticada que pase
   * la policy RLS de administrador creada en V25.1.
   */
  private async loadAllFromSupabase(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('appointments')
      .select(ADMIN_SELECT)
      .order('date', { ascending: false })
      .order('time', { ascending: false });

    if (error) {
      this._appointments.set([]);
      this.error.set(
        'No se pudieron cargar las citas administrativas. Verifica tu sesión.',
      );
      console.error('Error cargando citas desde Supabase:', error);
      return;
    }

    this._appointments.set(
      ((data ?? []) as SupabaseAppointmentRow[]).map((row) =>
        this.fromSupabaseRow(row),
      ),
    );
  }

  /**
   * Obtiene una cita específica para edición administrativa.
   *
   * Primero revisa el signal local. Si no existe:
   * - DEV: consulta json-server.
   * - PROD: consulta Supabase; RLS exige sesión admin.
   */
  async getById(id: number): Promise<Appointment | null> {
    this.error.set(null);

    const cached = this._appointments().find((a) => a.id === id);
    if (cached) {
      return cached;
    }

    if (environment.useSupabase) {
      const { data, error } = await this.supabase.client
        .from('appointments')
        .select(ADMIN_SELECT)
        .eq('id', id)
        .single();

      if (error) {
        this.error.set(
          'No se pudo cargar la cita. Verifica que exista y que tu sesión administrativa siga activa.',
        );
        console.error('Error cargando cita por ID desde Supabase:', error);
        return null;
      }

      const appointment = this.fromSupabaseRow(
        data as SupabaseAppointmentRow,
      );

      this._appointments.update((list) => {
        const exists = list.some((a) => a.id === appointment.id);
        return exists
          ? list.map((a) => (a.id === appointment.id ? appointment : a))
          : [...list, appointment];
      });

      return appointment;
    }

    try {
      const appointment = await firstValueFrom(
        this.http.get<Appointment>(`${API_URL}/${id}`),
      );

      this._appointments.update((list) => {
        const exists = list.some((a) => a.id === appointment.id);
        return exists
          ? list.map((a) => (a.id === appointment.id ? appointment : a))
          : [...list, appointment];
      });

      return appointment;
    } catch (e) {
      this.error.set('No se pudo cargar la cita.');
      console.error(e);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────
  // CREATE
  // ─────────────────────────────────────────────────────────

  async create(draft: AppointmentDraft): Promise<boolean> {
    this.error.set(null);

    if (environment.useSupabase) {
      return this.createInSupabase(draft);
    }

    return this.createInJsonServer(draft);
  }

  private async createInJsonServer(
    draft: AppointmentDraft,
  ): Promise<boolean> {
    if (this.hasConflict(draft)) {
      this.error.set('Ese barbero ya tiene una cita en ese horario.');
      return false;
    }

    try {
      const created = await firstValueFrom(
        this.http.post<Appointment>(API_URL, draft),
      );

      this._appointments.update((list) => [...list, created]);

      this.n8n.notify('created', created, {
        triggeredBy: 'client',
      });

      return true;
    } catch (e) {
      this.error.set('No se pudo crear la cita.');
      console.error(e);
      return false;
    }
  }

  private async createInSupabase(
    draft: AppointmentDraft,
  ): Promise<boolean> {
    try {
      const { error } = await this.supabase.client
        .from('appointments')
        .insert({
          client_name: draft.clientName,
          phone: draft.phone,
          email: draft.email,
          service_id: draft.serviceId,
          barber_id: draft.barberId,
          date: draft.date,
          time: draft.time,
          status: 'pendiente',
          notes: draft.notes ?? '',
        });

      if (!error) {
        return true;
      }

      if (error.code === '23505') {
        this.error.set(
          'Ese horario ya está ocupado. Elige otro horario.',
        );
        return false;
      }

      this.error.set(
        'No se pudo crear la cita. Intenta nuevamente.',
      );
      console.error('Error creando cita en Supabase:', error);
      return false;
    } catch (e) {
      this.error.set(
        'No se pudo crear la cita. Intenta nuevamente.',
      );
      console.error('Error creando cita en Supabase:', e);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────────────────

  async update(
    id: number,
    patch: Partial<AppointmentDraft>,
  ): Promise<Appointment | null> {
    this.error.set(null);

    if (environment.useSupabase) {
      return this.updateInSupabase(id, patch);
    }

    return this.updateInJsonServer(id, patch);
  }

  private async updateInJsonServer(
    id: number,
    patch: Partial<AppointmentDraft>,
  ): Promise<Appointment | null> {
    const previous = this._appointments().find((a) => a.id === id);

    if (patch.barberId || patch.date || patch.time) {
      if (!previous) {
        return null;
      }

      const merged = {
        ...previous,
        ...patch,
      } as AppointmentDraft;

      if (this.hasConflict(merged, id)) {
        this.error.set(
          'Ese barbero ya tiene una cita en ese horario.',
        );
        return null;
      }
    }

    try {
      const updated = await firstValueFrom(
        this.http.patch<Appointment>(
          `${API_URL}/${id}`,
          patch,
        ),
      );

      this._appointments.update((list) =>
        list.map((a) => (a.id === id ? updated : a)),
      );

      const event =
        updated.status === 'confirmada'
          ? 'confirmed'
          : updated.status === 'atendida'
            ? 'attended'
            : updated.status === 'cancelada'
              ? 'cancelled'
              : 'updated';

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

  /**
   * V25.2:
   * UPDATE administrativo en Supabase.
   *
   * RLS valida que la sesión pertenezca a admin_users.
   * La respuesta se selecciona porque el administrador sí cuenta
   * con SELECT autenticado.
   */
  private async updateInSupabase(
    id: number,
    patch: Partial<AppointmentDraft>,
  ): Promise<Appointment | null> {
    const payload: Record<string, unknown> = {};

    if (patch.clientName !== undefined) {
      payload['client_name'] = patch.clientName;
    }
    if (patch.phone !== undefined) {
      payload['phone'] = patch.phone;
    }
    if (patch.email !== undefined) {
      payload['email'] = patch.email;
    }
    if (patch.serviceId !== undefined) {
      payload['service_id'] = patch.serviceId;
    }
    if (patch.barberId !== undefined) {
      payload['barber_id'] = patch.barberId;
    }
    if (patch.date !== undefined) {
      payload['date'] = patch.date;
    }
    if (patch.time !== undefined) {
      payload['time'] = patch.time;
    }
    if (patch.status !== undefined) {
      payload['status'] = patch.status;
    }
    if (patch.notes !== undefined) {
      payload['notes'] = patch.notes;
    }

    if (Object.keys(payload).length === 0) {
      return this._appointments().find((a) => a.id === id) ?? null;
    }

    try {
      const { data, error } = await this.supabase.client
        .from('appointments')
        .update(payload)
        .eq('id', id)
        .select(ADMIN_SELECT)
        .single();

      if (error) {
        if (error.code === '23505') {
          this.error.set(
            'Ese horario ya está ocupado. Elige otro horario.',
          );
        } else {
          this.error.set(
            'No se pudo actualizar la cita. Verifica tu sesión.',
          );
        }

        console.error(
          'Error actualizando cita en Supabase:',
          error,
        );
        return null;
      }

      const updated = this.fromSupabaseRow(
        data as SupabaseAppointmentRow,
      );

      this._appointments.update((list) =>
        list.map((a) => (a.id === id ? updated : a)),
      );

      // V25.4 conectará las notificaciones de producción
      // desde un entorno seguro. No llamamos al webhook local aquí.
      return updated;
    } catch (e) {
      this.error.set('No se pudo actualizar la cita.');
      console.error(
        'Error actualizando cita en Supabase:',
        e,
      );
      return null;
    }
  }

  async changeStatus(
    id: number,
    status: AppointmentStatus,
  ): Promise<void> {
    await this.update(id, { status });
  }

  // ─────────────────────────────────────────────────────────
  // DELETE
  // ─────────────────────────────────────────────────────────

  async remove(id: number): Promise<void> {
    if (environment.useSupabase) {
      // En producción V25 se conserva historial:
      // cancelar ≠ eliminar físicamente.
      this.error.set(
        'El borrado permanente está deshabilitado en producción. Cancela la cita en su lugar.',
      );
      return;
    }

    try {
      const removed = this._appointments().find(
        (a) => a.id === id,
      );

      await firstValueFrom(
        this.http.delete(`${API_URL}/${id}`),
      );

      this._appointments.update((list) =>
        list.filter((a) => a.id !== id),
      );

      if (removed) {
        this.n8n.notify('deleted', removed, {
          triggeredBy: 'admin',
        });
      }
    } catch (e) {
      this.error.set('No se pudo eliminar la cita.');
      console.error(e);
    }
  }

  // ─────────────────────────────────────────────────────────
  // AVAILABILITY
  // ─────────────────────────────────────────────────────────

  hasConflict(
    draft: AppointmentDraft,
    ignoreId?: number,
  ): boolean {
    const start = this.toMinutes(draft.time);

    return this._appointments().some((a) => {
      if (a.id === ignoreId) return false;
      if (a.barberId !== draft.barberId) return false;
      if (a.date !== draft.date) return false;
      if (a.status === 'cancelada') return false;

      return this.toMinutes(a.time) === start;
    });
  }

  occupiedSlots(
    barberId: number,
    date: string,
  ): string[] {
    if (environment.useSupabase) {
      return this.occupiedSlotsByBarberDate();
    }

    return this._appointments()
      .filter(
        (a) =>
          a.barberId === barberId &&
          a.date === date &&
          a.status !== 'cancelada',
      )
      .map((a) => a.time);
  }

  async loadOccupiedSlots(
    barberId: number,
    date: string,
  ): Promise<void> {
    if (!environment.useSupabase) {
      return;
    }

    const myEpoch = ++this._epoch;

    this.occupiedSlotsByBarberDate.set([]);
    this.availabilityLoading.set(true);
    this.availabilityError.set(null);

    try {
      const { data, error } = await this.supabase.client.rpc(
        'get_occupied_slots',
        {
          p_barber_id: barberId,
          p_date: date,
        },
      );

      if (myEpoch !== this._epoch) {
        return;
      }

      if (error) {
        throw error;
      }

      const slots = (data ?? [])
        .map(
          (row: { time_slot: string }) =>
            row.time_slot,
        )
        .map((t: string) => t.slice(0, 5));

      this.occupiedSlotsByBarberDate.set(slots);
    } catch (e) {
      if (myEpoch !== this._epoch) {
        return;
      }

      console.error(
        'Error consultando disponibilidad:',
        e,
      );
      this.availabilityError.set(
        'No se pudo consultar la disponibilidad',
      );
    } finally {
      if (myEpoch === this._epoch) {
        this.availabilityLoading.set(false);
      }
    }
  }

  resetOccupiedSlots(): void {
    this._epoch++;
    this.occupiedSlotsByBarberDate.set([]);
    this.availabilityLoading.set(false);
    this.availabilityError.set(null);
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  private fromSupabaseRow(
    row: SupabaseAppointmentRow,
  ): Appointment {
    return {
      id: row.id,
      clientName: row.client_name,
      phone: row.phone,
      email: row.email,
      serviceId: row.service_id,
      barberId: row.barber_id,
      date: row.date,
      time: row.time.slice(0, 5),
      status: row.status,
      notes: row.notes ?? '',
    };
  }

  private toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }
}
