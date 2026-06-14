import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppointmentService, BarberService, ServiceCatalogService } from './core/services';

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
   * Precargamos los catálogos al iniciar la app.
   * json-server debe estar corriendo (npm run server) o
   * el módulo de Citas cargará datos vacíos.
   */
  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.appointments.loadAll(),
      this.barbers.loadAll(),
      this.catalog.loadAll(),
    ]);
  }
}
