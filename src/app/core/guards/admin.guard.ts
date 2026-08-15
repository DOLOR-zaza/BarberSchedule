import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

/**
 * V25.1C
 * - Desarrollo local: conserva el acceso directo existente.
 * - Producción: exige una sesión Supabase válida y usuario administrador.
 */
export const adminGuard: CanMatchFn = async (_route, segments) => {
  if (!environment.useSupabase) {
    return true;
  }

  const auth = inject(AuthService);
  const router = inject(Router);

  // Asegura que la sesión persistida del navegador haya sido restaurada
  // antes de tomar la decisión del guard.
  await auth.restoreSession();

  if (auth.isAuthenticated() && auth.isAdmin()) {
    return true;
  }

  const returnUrl =
    '/' + segments.map((segment) => segment.path).filter(Boolean).join('/');

  return router.createUrlTree(['/login'], {
    queryParams: {
      returnUrl: returnUrl || '/gestion',
    },
  });
};
