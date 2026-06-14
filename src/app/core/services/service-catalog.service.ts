import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { BarberService as Service } from '../models';

const API_URL = 'http://127.0.0.1:3001/services';

@Injectable({ providedIn: 'root' })
export class ServiceCatalogService {
  private http = inject(HttpClient);

  private readonly _services = signal<Service[]>([]);
  readonly services = this._services.asReadonly();
  readonly loading = signal<boolean>(false);

  async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await firstValueFrom(this.http.get<Service[]>(API_URL));
      this._services.set(data);
    } catch (e) {
      console.error('Error cargando servicios', e);
    } finally {
      this.loading.set(false);
    }
  }

  getById(id: number): Service | undefined {
    return this._services().find((s) => s.id === id);
  }
}
