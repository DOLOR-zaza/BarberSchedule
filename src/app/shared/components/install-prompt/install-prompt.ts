import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Banner de instalación PWA.
 *
 * Escucha el evento `beforeinstallprompt` que dispara el navegador
 * cuando la app cumple los requisitos para instalarse. Muestra un
 * banner discreto abajo de la pantalla invitando al usuario.
 *
 * Si el usuario acepta, dispara el prompt nativo. Si rechaza o
 * cierra, lo recordamos en localStorage para no molestarlo de nuevo.
 */
@Component({
  selector: 'app-install-prompt',
  template: `
    @if (showBanner()) {
      <div
        role="dialog"
        aria-label="Instalar BarberSchedule"
        class="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-50"
      >
        <div class="glass rounded-2xl p-4 ring-1 ring-brand-500/30 shadow-2xl shadow-brand-500/10 flex items-start gap-3 animate-slide-up">
          <div class="text-3xl">💈</div>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-ink-100 text-sm">Instala BarberSchedule</p>
            <p class="text-ink-400 text-xs mt-0.5">
              Acceso rápido desde tu pantalla de inicio, sin barra del navegador.
            </p>
            <div class="flex gap-2 mt-3">
              <button
                type="button"
                (click)="install()"
                class="px-3 py-1.5 rounded-full bg-brand-500 hover:bg-brand-400 text-ink-950 text-xs font-bold transition-all"
              >
                Instalar
              </button>
              <button
                type="button"
                (click)="dismiss()"
                class="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-ink-300 text-xs font-medium transition-all"
              >
                Ahora no
              </button>
            </div>
          </div>
          <button
            type="button"
            (click)="dismiss()"
            aria-label="Cerrar"
            class="text-ink-500 hover:text-ink-200 text-lg leading-none -mt-1"
          >×</button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallPrompt implements OnInit, OnDestroy {
  protected readonly showBanner = signal<boolean>(false);

  private deferred: BeforeInstallPromptEvent | null = null;
  private readonly handler = (e: Event) => this.onPrompt(e);

  ngOnInit(): void {
    if (typeof window === 'undefined') return;

    // Si ya rechazó antes, no mostramos.
    if (localStorage.getItem('barberschedule.installDismissed') === '1') {
      return;
    }

    // Si ya está instalada como PWA, no mostramos.
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return;
    }

    window.addEventListener('beforeinstallprompt', this.handler);

    // Para iOS (no dispara beforeinstallprompt, hay que mostrar
    // instrucciones manuales). Lo dejamos para una versión futura.
  }

  ngOnDestroy(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('beforeinstallprompt', this.handler);
  }

  private onPrompt(e: Event): void {
    e.preventDefault();
    this.deferred = e as BeforeInstallPromptEvent;
    // Damos un pequeño delay para que no aparezca apenas carga.
    setTimeout(() => this.showBanner.set(true), 3000);
  }

  protected async install(): Promise<void> {
    if (!this.deferred) return;
    this.showBanner.set(false);
    await this.deferred.prompt();
    const { outcome } = await this.deferred.userChoice;
    if (outcome === 'dismissed') {
      this.rememberDismiss();
    }
    this.deferred = null;
  }

  protected dismiss(): void {
    this.showBanner.set(false);
    this.rememberDismiss();
  }

  private rememberDismiss(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('barberschedule.installDismissed', '1');
  }
}
