import { inject } from '@angular/core';
import { CanMatchFn, Router, Routes } from '@angular/router';
import { environment } from '../environments/environment';

/**
 * V24 pública:
 * las pantallas que requieren leer/modificar appointments permanecen
 * disponibles en desarrollo, pero quedan cerradas en producción
 * hasta implementar Supabase Auth en V25.
 */
const localOnlyGuard: CanMatchFn = () => {
  if (!environment.useSupabase) {
    return true;
  }

  return inject(Router).createUrlTree(['/inicio']);
};

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./layout/main-layout/main-layout').then((m) => m.MainLayout),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'inicio',
      },
      {
        path: 'inicio',
        title: 'Inicio · BarberSchedule',
        loadComponent: () =>
          import('./features/home/home-page').then((m) => m.HomePage),
      },
      {
        path: 'citas',
        title: 'Citas · BarberSchedule',
        canMatch: [localOnlyGuard],
        loadComponent: () =>
          import('./features/appointments/pages/appointment-list/appointment-list-page')
            .then((m) => m.AppointmentListPage),
      },
      {
        path: 'nueva-cita',
        title: 'Nueva cita · BarberSchedule',
        loadComponent: () =>
          import('./features/appointments/pages/appointment-form/appointment-form-page')
            .then((m) => m.AppointmentFormPage),
      },
      {
        path: 'citas/editar/:id',
        title: 'Editar cita · BarberSchedule',
        canMatch: [localOnlyGuard],
        loadComponent: () =>
          import('./features/appointments/pages/appointment-form/appointment-form-page')
            .then((m) => m.AppointmentFormPage),
      },
      {
        path: 'servicios',
        title: 'Servicios · BarberSchedule',
        loadComponent: () =>
          import('./features/services-catalog/pages/services-list/services-list-page')
            .then((m) => m.ServicesListPage),
      },
      {
        path: 'barberos',
        title: 'Barberos · BarberSchedule',
        loadComponent: () =>
          import('./features/barbers/pages/barbers-list/barbers-list-page')
            .then((m) => m.BarbersListPage),
      },
      {
        path: 'asistente',
        title: 'Asistente · BarberSchedule',
        loadComponent: () =>
          import('./features/assistant/pages/assistant-page/assistant-page')
            .then((m) => m.AssistantPage),
      },
      {
        path: 'acerca-de',
        title: 'Acerca de · BarberSchedule',
        loadComponent: () =>
          import('./features/home/about-page').then((m) => m.AboutPage),
      },
      {
        path: 'gestion',
        title: 'Gestión · BarberSchedule',
        canMatch: [localOnlyGuard],
        loadComponent: () =>
          import('./features/admin/pages/gestion/gestion-page')
            .then((m) => m.GestionPage),
      },
    ],
  },
  { path: '**', redirectTo: 'inicio' },
];
