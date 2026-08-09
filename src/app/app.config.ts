import { ApplicationConfig, ErrorHandler, isDevMode, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { GlobalErrorHandler } from './shared/components/error-boundary/error-boundary';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),   // Angular 21: detección zoneless
    provideRouter(
      routes,
      withComponentInputBinding(),        // habilita @Input() desde route params
      withViewTransitions(),              // transiciones suaves entre rutas
    ),
    provideHttpClient(withFetch()),
    provideAnimations(),

    // Service Worker (PWA). Solo se activa en producción.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),

    // Captura global de errores → muestra UI elegante
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
};
