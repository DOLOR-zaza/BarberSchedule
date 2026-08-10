import { ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AppointmentService, BarberService, ServiceCatalogService } from '../../core/services';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { TiltOnHoverDirective } from '../../shared/directives/tilt-on-hover.directive';
import { Hero3dScene } from '../../shared/components/hero3d-scene/hero3d-scene';
import { AnimatedCounterDirective } from '../../shared/directives/animated-counter.directive';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';


@Component({
  selector: 'app-home-page',
  imports: [RouterLink, StatusBadge, TiltOnHoverDirective, Hero3dScene, AnimatedCounterDirective],
  templateUrl: './home-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly appts  = inject(AppointmentService);
  protected readonly barbers = inject(BarberService);
  protected readonly catalog = inject(ServiceCatalogService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);

protected readonly booked = toSignal(
  this.route.queryParamMap.pipe(
    map((p) => p.get('booked') === 'true'),
  ),
  { initialValue: false },
);

  /** Próximas 3 citas confirmadas o pendientes, ordenadas por fecha/hora. */
  protected readonly upcoming = computed(() =>
    [...this.appts.appointments()]
      .filter((a) => a.status === 'confirmada' || a.status === 'pendiente')
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .slice(0, 3),
  );

  protected serviceName(id: number): string {
    return this.catalog.getById(id)?.name ?? '—';
  }

  protected barberName(id: number): string {
    return this.barbers.getById(id)?.name ?? '—';
  }

  protected serviceIcon(id: number): string {
    return this.catalog.getById(id)?.icon ?? '✂️';
  }

  /** Stats con AnimatedCounter — arrancan en 0 y suben al cargar. */
  protected readonly stats = computed(() => ({
    total:      this.appts.count(),
    today:      this.appts.todayCount(),
    pending:    this.appts.countsByStatus().pendiente,
    confirmed:  this.appts.countsByStatus().confirmada,
  }));

  protected readonly isBrowser = isPlatformBrowser(this.platformId);
}
