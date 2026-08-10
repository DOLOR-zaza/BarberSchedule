import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { BarberService as Service } from '../models';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class ServiceCatalogService {
  private http = inject(HttpClient);
  private supabase = inject(SupabaseService);

  private readonly _services = signal<Service[]>([]);
  readonly services = this._services.asReadonly();
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
      console.error('Error cargando servicios', e);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadFromJsonServer(): Promise<void> {
    const data = await firstValueFrom(
      this.http.get<Service[]>(`${environment.apiUrl}/services`),
    );
    this._services.set(data);
  }

  private async loadFromSupabase(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('services')
      .select('*')
      .order('id');
    if (error) throw error;
    this._services.set(
      (data ?? []).map((row) => ({
        id: Number(row.id),
        name: row.name,
        duration: Number(row.duration),
        price: Number(row.price),
        icon: row.icon ?? '',
      })),
    );
  }

  getById(id: number): Service | undefined {
    return this._services().find((s) => s.id === id);
  }
}
