import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
} from '@angular/core';

export type ConfirmVariant = 'primary' | 'danger';

/**
 * Modal de confirmación reutilizable. No se monta en el DOM
 * hasta que `open` es true, evitando listeners innecesarios.
 *
 * Uso:
 *   <app-confirm-modal
 *     [open]="showConfirm()"
 *     title="¿Eliminar cita?"
 *     message="Esta acción no se puede deshacer."
 *     variant="danger"
 *     (confirm)="onConfirm()"
 *     (cancel)="showConfirm.set(false)"
 *   />
 */
@Component({
  selector: 'app-confirm-modal',
  template: `
    @if (open()) {
      <!-- Backdrop -->
      <div
        class="fixed inset-0 z-50 grid place-items-center p-4 bg-ink-950/70 backdrop-blur-sm animate-fade-in"
        (click)="onBackdropClick($event)"
      >
        <!-- Dialog -->
        <div
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="'cm-title'"
          class="glass rounded-2xl shadow-2xl shadow-black/50 max-w-md w-full p-6 animate-pop-in"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-start gap-4 mb-4">
            <div
              class="flex-shrink-0 w-12 h-12 rounded-full grid place-items-center text-2xl"
              [class]="iconClasses()"
            >
              {{ icon() }}
            </div>
            <div class="flex-1 pt-1">
              <h3 id="cm-title" class="font-display text-xl font-semibold text-ink-100 mb-1">
                {{ title() }}
              </h3>
              <p class="text-ink-300 text-sm leading-relaxed">
                {{ message() }}
              </p>
            </div>
            <button
              type="button"
              class="text-ink-500 hover:text-ink-200 transition-colors text-xl leading-none"
              (click)="onCancel()"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>

          <div class="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end mt-6">
            <button
              type="button"
              class="px-5 py-2.5 rounded-full text-sm font-medium text-ink-200 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition-all"
              (click)="onCancel()"
            >
              {{ cancelText() }}
            </button>
            <button
              type="button"
              class="px-5 py-2.5 rounded-full text-sm font-semibold transition-all shadow-lg"
              [class]="confirmClasses()"
              (click)="onConfirm()"
              [attr. autofocus]="true"
            >
              {{ confirmText() }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes pop-in {
      from { opacity: 0; transform: scale(0.92) translateY(8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    .animate-fade-in { animation: fade-in 0.2s ease-out both; }
    .animate-pop-in  { animation: pop-in  0.25s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmModal {
  /** Si el modal está visible. */
  readonly open = input<boolean>(false);

  /** Título del modal. */
  readonly title = input<string>('¿Estás seguro?');

  /** Mensaje descriptivo. */
  readonly message = input<string>('');

  /** Variante: 'primary' (brand) o 'danger' (rojo). */
  readonly variant = input<ConfirmVariant>('primary');

  /** Texto del botón de confirmar. */
  readonly confirmText = input<string>('Confirmar');

  /** Texto del botón de cancelar. */
  readonly cancelText = input<string>('Cancelar');

  /** Emite cuando el usuario confirma. */
  readonly confirm = output<void>();

  /** Emite cuando el usuario cancela o cierra. */
  readonly cancel = output<void>();

  protected readonly icon = computed(() =>
    this.variant() === 'danger' ? '⚠️' : 'ℹ️',
  );

  protected readonly iconClasses = computed(() =>
    this.variant() === 'danger'
      ? 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30'
      : 'bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/30',
  );

  protected readonly confirmClasses = computed(() =>
    this.variant() === 'danger'
      ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/30'
      : 'bg-brand-500 hover:bg-brand-400 text-ink-950 shadow-brand-500/30',
  );

  /** Cierra con ESC. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.onCancel();
  }

  protected onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.onCancel();
  }

  protected onCancel(): void {
    this.cancel.emit();
  }

  protected onConfirm(): void {
    this.confirm.emit();
  }
}
