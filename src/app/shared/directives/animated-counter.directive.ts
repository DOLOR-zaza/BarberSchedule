import {
  Directive,
  ElementRef,
  inject,
  input,
  numberAttribute,
  OnInit,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { gsap } from 'gsap';

/**
 * Anima un número en el elemento host desde 0 hasta `value`
 * usando GSAP. Se dispara cuando el elemento entra al viewport.
 *
 * Uso:
 *   <span [appAnimatedCounter]="42">0</span>
 *   <span [appAnimatedCounter]="100" [duration]="2000" [prefix]="$">0</span>
 */
@Directive({
  selector: '[appAnimatedCounter]',
  standalone: true,
})
export class AnimatedCounterDirective implements OnInit {
  private host = inject(ElementRef<HTMLElement>);
  private platformId = inject(PLATFORM_ID);

  /** Valor final al que animar. */
  readonly appAnimatedCounter = input.required({ transform: numberAttribute });

  /** Duración de la animación en ms. Default: 1500 */
  readonly duration = input(1500, { transform: numberAttribute });

  /** Prefijo (ej. "$") */
  readonly prefix = input<string>('');

  /** Sufijo (ej. "%", " min") */
  readonly suffix = input<string>('');

  /** Delay antes de iniciar (ms). Default: 0 */
  readonly delay = input(0, { transform: numberAttribute });

  /** Si true, inicia inmediatamente sin esperar al viewport. Default: true. */
  readonly immediate = input(true);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const el = this.host.nativeElement;
    const target = this.appAnimatedCounter();
    const duration = this.duration() / 1000; // gsap usa segundos
    const delay = this.delay() / 1000;

    if (this.immediate()) {
      this.runAnimation(el, target, duration, delay);
    } else {
      // Esperar a que entre al viewport
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.runAnimation(el, target, duration, delay);
            observer.disconnect();
          }
        }
      });
      observer.observe(el);
    }
  }

  private runAnimation(el: HTMLElement, target: number, duration: number, delay: number): void {
    const obj = { val: 0 };
    const prefix = this.prefix();
    const suffix = this.suffix();
    gsap.to(obj, {
      val: target,
      duration,
      delay,
      ease: 'power2.out',
      onUpdate: () => {
        // Redondear si es entero, si no, 1 decimal
        const isInt = Number.isInteger(target);
        const display = isInt ? Math.round(obj.val) : obj.val.toFixed(1);
        el.textContent = `${prefix}${display}${suffix}`;
      },
    });
  }
}
