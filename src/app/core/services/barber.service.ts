import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Barber } from '../models';

const API_URL = 'http://127.0.0.1:3001/barbers';

@Injectable({ providedIn: 'root' })
export class BarberService {
  private http = inject(HttpClient);

  private readonly _barbers = signal<Barber[]>([]);
  readonly barbers = this._barbers.asReadonly();
  readonly loading = signal<boolean>(false);

  async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await firstValueFrom(this.http.get<Barber[]>(API_URL));
      this._barbers.set(data);
    } catch (e) {
      console.error('Error cargando barberos', e);
    } finally {
      this.loading.set(false);
    }
  }

  getById(id: number): Barber | undefined {
    return this._barbers().find((b) => b.id === id);
  }
}
