import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AppointmentService,
  AuthService,
  BarberService,
  ServiceCatalogService,
} from '../../core/services';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { TiltOnHoverDirective } from '../../shared/directives/tilt-on-hover.directive';
import { Hero3dScene } from '../../shared/components/hero3d-scene/hero3d-scene';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-home-page',
  imports: [
    RouterLink,
    StatusBadge,
    TiltOnHoverDirective,
    Hero3dScene,
  ],
  templateUrl: './home-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly appts = inject(AppointmentService);
  protected readonly barbers = inject(BarberService);
  protected readonly catalog = inject(ServiceCatalogService);

  private readonly auth = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);

  private adminLoadRequested = false;

  /**
   * DEV conserva el dashboard local.
   * PROD solo muestra información de citas cuando Supabase confirmó
   * que la sesión pertenece a un administrador.
   *
   * Se mantiene como getter para no cambiar el HTML de V24,
   * que ya usa @if (showAppointmentData).
   */
  protected get showAppointmentData(): boolean {
    return !environment.useSupabase || this.auth.isAdmin();
  }

  protected readonly booked = toSignal(
    this.route.queryParamMap.pipe(
      map((p) => p.get('booked') === 'true'),
    ),
    { initialValue: false },
  );

  /**
   * Próximas 3 citas pendientes/confirmadas que todavía no han pasado.
   */
  protected readonly upcoming = computed(() => {
    const now = new Date();
    const today = localDateKey(now);
    const currentTime = localTimeKey(now);

    return [...this.appts.appointments()]
      .filter(
        (a) =>
          (a.status === 'confirmada' || a.status === 'pendiente') &&
          (
            a.date > today ||
            (a.date === today && a.time >= currentTime)
          ),
      )
      .sort((a, b) =>
        (a.date + a.time).localeCompare(b.date + b.time),
      )
      .slice(0, 3);
  });

  /**
   * Dashboard administrativo.
   * El conteo de "Hoy" usa fecha LOCAL del navegador en vez de UTC.
   */
  protected readonly stats = computed(() => {
    const today = localDateKey(new Date());

    return {
      total: this.appts.count(),
      today: this.appts
        .appointments()
        .filter((a) => a.date === today)
        .length,
      pending: this.appts.countsByStatus().pendiente,
      confirmed: this.appts.countsByStatus().confirmada,
    };
  });

  protected readonly isBrowser = isPlatformBrowser(this.platformId);

  constructor() {
    /**
     * App no carga appointments globalmente en producción para proteger PII.
     * Una vez que AuthService confirma al admin, Home solicita el SELECT
     * protegido por RLS y llena el dashboard.
     */
    effect(() => {
      const isAdmin = this.auth.isAdmin();

      if (!environment.useSupabase) {
        return;
      }

      if (!isAdmin) {
        this.adminLoadRequested = false;
        return;
      }

      if (this.adminLoadRequested) {
        return;
      }

      this.adminLoadRequested = true;
      void this.appts.loadAll();
    });
  }

  protected serviceName(id: number): string {
    return this.catalog.getById(id)?.name ?? '—';
  }

  protected barberName(id: number): string {
    return this.barbers.getById(id)?.name ?? '—';
  }

  protected serviceIcon(id: number): string {
    return this.catalog.getById(id)?.icon ?? '✂️';
  }
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function localTimeKey(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${hours}:${minutes}`;
}
