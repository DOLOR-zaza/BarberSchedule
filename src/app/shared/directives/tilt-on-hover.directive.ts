import {
  Directive,
  ElementRef,
  HostListener,
  inject,
  input,
  numberAttribute,
} from '@angular/core';

/**
 * Aplica un efecto de inclinación 3D al elemento basado en la
 * posición del cursor. Usa CSS custom properties `--rx` y `--ry`
 * para mantenerlo performante (sin re-render del DOM).
 *
 * Requiere que el elemento (o un ancestro con `.tilt-3d`) tenga
 * `transform-style: preserve-3d` y `perspective(...)` en hover.
 * Esas reglas ya están en `src/styles.css` con la clase `.tilt-3d`.
 *
 * Uso:
 *   <div class="tilt-3d" appTiltOnHover> ... </div>
 *   <div class="tilt-3d" appTiltOnHover [intensity]="20"> ... </div>
 */
@Directive({
  selector: '[appTiltOnHover]',
  standalone: true,
})
export class TiltOnHoverDirective {
  private host = inject(ElementRef<HTMLElement>);

  /** Intensidad de la rotación en grados (default 12). */
  readonly intensity = input(12, { transform: numberAttribute });

  /** Activar un leve "lift" (translateZ) al hover. Default true. */
  readonly lift = input(true, { transform: (v: unknown) => v !== false });

  @HostListener('mousemove', ['$event'])
  onMouseMove(e: MouseEvent): void {
    const el = this.host.nativeElement;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;   // 0..1
    const y = (e.clientY - rect.top)  / rect.height;  // 0..1

    // -intensity..+intensity, invertido en Y para que "siga" al mouse
    const ry = (x - 0.5) *  2 * this.intensity();
    const rx = (y - 0.5) * -2 * this.intensity();

    el.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
    el.style.setProperty('--ry', `${ry.toFixed(2)}deg`);

    if (this.lift()) {
      el.style.setProperty('--tz', '20px');
    }
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    const el = this.host.nativeElement;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--tz', '0px');
  }
}
