import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ErrorBoundary } from '../../shared/components/error-boundary/error-boundary';
import { InstallPrompt } from '../../shared/components/install-prompt/install-prompt';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ErrorBoundary, InstallPrompt],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainLayout {
  protected readonly navItems: NavItem[] = [
    { label: 'Inicio',     path: '/inicio',     icon: '🏠' },
    { label: 'Citas',      path: '/citas',      icon: '📅' },
    { label: 'Servicios',  path: '/servicios',  icon: '✂️' },
    { label: 'Barberos',   path: '/barberos',   icon: '💈' },
    { label: 'Asistente',  path: '/asistente',  icon: '🤖' },
    { label: 'Acerca de',  path: '/acerca-de',  icon: 'ℹ️' },
  ];

  protected readonly mobileOpen = signal(false);
  protected readonly scrolled   = signal(false);

  constructor(router: Router) {
    // Cierra el menú móvil automáticamente al cambiar de ruta
    router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.closeMobile());
  }

  toggleMobile() {
    this.mobileOpen.update((v) => !v);
  }

  closeMobile() {
    this.mobileOpen.set(false);
  }
}
