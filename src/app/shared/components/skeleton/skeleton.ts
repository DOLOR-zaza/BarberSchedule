import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Skeleton loader — bloque animado con shimmer para estados de carga.
 *
 * Uso:
 *   <app-skeleton width="w-full" height="h-4" />
 *   <app-skeleton variant="circle" width="w-12" height="h-12" />
 *   <app-skeleton variant="card" />
 */
@Component({
  selector: 'app-skeleton',
  template: `
    <div
      role="status"
      aria-label="Cargando..."
      [class]="classes()"
      [style.width]="customWidth()"
      [style.height]="customHeight()"
    ></div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Skeleton {
  readonly variant = input<'text' | 'circle' | 'card' | 'block'>('block');
  readonly width = input<string>('');  // ej: 'w-full' o '120px'
  readonly height = input<string>('');
  readonly customWidth = input<string>('');
  readonly customHeight = input<string>('');

  protected classes(): string {
    const base = 'skeleton-shimmer bg-white/5 animate-pulse';
    switch (this.variant()) {
      case 'text':   return `${base} h-4 w-full rounded`;
      case 'circle': return `${base} rounded-full ${this.width()} ${this.height()}`;
      case 'card':   return `${base} w-full h-32 rounded-2xl`;
      default:       return `${base} w-full h-4 rounded ${this.width()} ${this.height()}`;
    }
  }
}
