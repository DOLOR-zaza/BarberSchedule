import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ServiceCatalogService } from '../../../../core/services';

/**
 * Catálogo de servicios con flip cards 3D.
 *
 *  FRENTE:  icono + nombre del servicio
 *  REVERSO: precio + duración + botón "Agendar"
 *
 * El flip se activa en hover (desktop) o click (touch).
 * Soporta múltiples cards flipeadas a la vez gracias al signal.
 */
@Component({
  selector: 'app-services-list-page',
  imports: [RouterLink],
  templateUrl: './services-list-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServicesListPage {
  private catalog = inject(ServiceCatalogService);
  private router  = inject(Router);

  protected readonly services = this.catalog.services;
  protected readonly loading  = this.catalog.loading;

  /** Ids de cards volteadas (para soporte touch). */
  protected readonly flipped = signal<Set<number>>(new Set());

  protected toggleFlip(id: number): void {
    this.flipped.update((set) => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  protected isFlipped(id: number): boolean {
    return this.flipped().has(id);
  }

  protected bookService(id: number, e?: Event): void {
    e?.stopPropagation();
    this.router.navigate(['/nueva-cita'], { queryParams: { service: id } });
  }
}
