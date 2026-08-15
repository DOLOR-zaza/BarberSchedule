import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { ErrorBoundary } from '../../shared/components/error-boundary/error-boundary';
import { InstallPrompt } from '../../shared/components/install-prompt/install-prompt';
import { environment } from '../../../environments/environment';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-main-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ErrorBoundary,
    InstallPrompt,
  ],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainLayout {
  private readonly auth = inject(AuthService);

  /**
   * En DEV mantenemos las herramientas locales.
   * En PROD aparecen únicamente cuando Supabase confirmó que el usuario es admin.
   */
  protected readonly showAdminTools = computed(
    () => !environment.useSupabase || this.auth.isAdmin(),
  );

  protected readonly navItems = computed<NavItem[]>(() => [
    { label: 'Inicio', path: '/inicio', icon: '🏠' },
    ...(this.showAdminTools()
      ? [{ label: 'Citas', path: '/citas', icon: '📅' }]
      : []),
    { label: 'Servicios', path: '/servicios', icon: '✂️' },
    { label: 'Barberos', path: '/barberos', icon: '💈' },
    { label: 'Asistente', path: '/asistente', icon: '🤖' },
    { label: 'Acerca de', path: '/acerca-de', icon: 'ℹ️' },
  ]);

  protected readonly internalAccessPath = computed(() =>
    this.showAdminTools() ? '/gestion' : '/login',
  );

  protected readonly internalAccessTitle = computed(() =>
    this.showAdminTools() ? 'Panel de gestión' : 'Acceso administrador',
  );

  protected readonly mobileOpen = signal(false);
  protected readonly scrolled = signal(false);

  constructor(router: Router) {
    router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.closeMobile());
  }

  toggleMobile(): void {
    this.mobileOpen.update((v) => !v);
  }

  closeMobile(): void {
    this.mobileOpen.set(false);
  }
}
