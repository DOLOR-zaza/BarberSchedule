import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Barber } from '../models';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class BarberService {
  private http = inject(HttpClient);
  private supabase = inject(SupabaseService);

  private readonly _barbers = signal<Barber[]>([]);
  readonly barbers = this._barbers.asReadonly();
  readonly loading = signal<boolean>(false);

  async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      if (environment.useSupabase) {
        await this.loadFromSupabase();
      } else {
        await this.loadFromJsonServer();
      }
    } catch (e) {
      console.error('Error cargando barberos', e);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadFromJsonServer(): Promise<void> {
    const data = await firstValueFrom(
      this.http.get<Barber[]>(`${environment.apiUrl}/barbers`),
    );
    this._barbers.set(data);
  }

  private async loadFromSupabase(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('barbers')
      .select('*')
      .order('id');
    if (error) throw error;
    this._barbers.set(
      (data ?? []).map((row) => ({
        id: Number(row.id),
        name: row.name,
        specialty: row.specialty ?? '',
        available: Boolean(row.available),
        avatar: row.avatar ?? '',
        experience: Number(row.experience),
      })),
    );
  }

  getById(id: number): Barber | undefined {
    return this._barbers().find((b) => b.id === id);
  }
}
