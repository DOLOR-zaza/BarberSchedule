import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppointmentService, BarberService } from '../../../../core/services';
import { TiltOnHoverDirective } from '../../../../shared/directives/tilt-on-hover.directive';

/**
 * Página del equipo. Muestra cada barbero con:
 *  - Avatar, nombre, especialidad, años de experiencia
 *  - Conteo de citas próximas que tiene
 *  - Botón para agendar con él
 */
@Component({
  selector: 'app-barbers-list-page',
  imports: [RouterLink, TiltOnHoverDirective],
  templateUrl: './barbers-list-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarbersListPage {
  private barbersSvc = inject(BarberService);
  private apptsSvc   = inject(AppointmentService);
  private router     = inject(Router);

  protected readonly barbers  = this.barbersSvc.barbers;
  protected readonly loading  = this.barbersSvc.loading;
  protected readonly appts    = this.apptsSvc.appointments;

  /**
   * Citas próximas por barbero (no canceladas, fecha >= hoy).
   * Usado para mostrar "X citas esta semana" en cada card.
   */
  protected upcomingByBarber = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map<number, number>();
    for (const a of this.appts()) {
      if (a.status === 'cancelada') continue;
      if (a.date < today) continue;
      map.set(a.barberId, (map.get(a.barberId) ?? 0) + 1);
    }
    return map;
  });

  protected upcomingCount(barberId: number): number {
    return this.upcomingByBarber().get(barberId) ?? 0;
  }

  protected bookWith(barberId: number): void {
    // Navega al form, sin query param extra (el stepper permite elegir barbero en paso 2)
    this.router.navigate(['/nueva-cita'], { queryParams: { barber: barberId } });
  }
}
