import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

const PRODUCTION_AI_WEBHOOK =
  'https://dolor-zaza.app.n8n.cloud/webhook/barberschedule-chat';

// En producción BarberBot siempre inicia usando la IA.
// También corrige configuraciones antiguas guardadas en localStorage.
if (environment.production && typeof localStorage !== 'undefined') {
  localStorage.setItem('barberschedule.chatMode', 'ai');
  localStorage.setItem(
    'barberschedule.aiWebhook',
    PRODUCTION_AI_WEBHOOK
  );
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));