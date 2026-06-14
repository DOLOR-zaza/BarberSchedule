import {
  ChangeDetectionStrategy,
  Component,
  ErrorHandler,
  Injectable,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Servicio global de errores. Captura cualquier error no manejado
 * y lo expone vía signal para que el ErrorBoundary UI lo muestre.
 */
@Injectable({ providedIn: 'root' })
export class GlobalErrorHandler implements ErrorHandler {
  readonly error = signal<unknown>(null);

  handleError(error: unknown): void {
    console.error('[BarberSchedule] Error global:', error);
    this.error.set(error);
  }
}

/**
 * Componente que muestra una pantalla de error elegante cuando algo
 * se rompe. Se debe colocar cerca del root, idealmente en el layout.
 *
 * Uso:
 *   <app-error-boundary />
 */
@Component({
  selector: 'app-error-boundary',
  imports: [RouterLink],
  template: `
    @if (handler.error()) {
      <div
        role="alert"
        aria-live="assertive"
        class="fixed inset-0 z-50 grid place-items-center bg-ink-950/90 backdrop-blur-sm p-4"
      >
        <div class="glass max-w-md w-full rounded-2xl p-8 text-center">
          <div class="text-6xl mb-4">⚠️</div>
          <h2 class="font-display text-2xl font-bold mb-2">Algo salió mal</h2>
          <p class="text-ink-300 text-sm mb-6">
            Tuvimos un problema técnico. Tu trabajo está a salvo —
            inténtalo de nuevo o vuelve al inicio.
          </p>
          <div class="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              (click)="reload()"
              class="px-5 py-2.5 rounded-full bg-brand-500 hover:bg-brand-400 text-ink-950 font-semibold text-sm transition-all"
            >
              ↻ Reintentar
            </button>
            <a
              routerLink="/inicio"
              (click)="dismiss()"
              class="px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-ink-100 font-medium text-sm transition-all"
            >
              Ir a inicio
            </a>
          </div>
          @if (isDev()) {
            <details class="mt-6 text-left">
              <summary class="text-xs text-ink-500 cursor-pointer hover:text-ink-300">
                Detalles técnicos (solo desarrollo)
              </summary>
              <pre class="mt-2 p-3 rounded-lg bg-ink-900 text-xs text-rose-300 overflow-auto max-h-40">{{ getError() }}</pre>
            </details>
          }
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorBoundary {
  protected readonly handler = inject(GlobalErrorHandler);

  protected getError(): string {
    const e = this.handler.error();
    if (e instanceof Error) return `${e.name}: ${e.message}\n${e.stack ?? ''}`;
    try { return JSON.stringify(e, null, 2); } catch { return String(e); }
  }

  protected isDev(): boolean {
    return typeof window !== 'undefined' && !!(window as { ng?: { isDevMode?: () => boolean } }).ng?.isDevMode?.();
  }

  protected reload(): void {
    this.dismiss();
    if (typeof window !== 'undefined') window.location.reload();
  }

  protected dismiss(): void {
    this.handler.error.set(null);
  }
}
