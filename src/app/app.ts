import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  AppointmentService,
  BarberService,
  ServiceCatalogService,
} from './core/services';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private appointments = inject(AppointmentService);
  private barbers      = inject(BarberService);
  private catalog      = inject(ServiceCatalogService);

  /**
   * Precarga de datos globales.
   *
   * Dev:
   *   services/barbers/appointments → json-server
   *
   * Prod:
   *   services/barbers → Supabase
   *   appointments NO se cargan públicamente porque contienen PII
   *   y SELECT está bloqueado por diseño.
   */
  async ngOnInit(): Promise<void> {
    const loads: Promise<void>[] = [
      this.barbers.loadAll(),
      this.catalog.loadAll(),
    ];

    if (!environment.useSupabase) {
      loads.push(this.appointments.loadAll());
    }

    await Promise.all(loads);
  }
}
