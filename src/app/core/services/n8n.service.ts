import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Appointment } from '../models';

export type NotificationEvent =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'confirmed'
  | 'cancelled'
  | 'attended';

export interface NotificationPayload {
  event: NotificationEvent;
  timestamp: string;
  appointment: Appointment;
  metadata?: {
    previousStatus?: string;
    triggeredBy?: 'client' | 'admin';
  };
}

export interface NotificationResult {
  delivered: boolean;
  mode: 'demo' | 'live' | 'disabled' | 'error';
  message: string;
}

/**
 * Servicio de notificaciones via n8n.
 *
 * n8n es un orquestador de workflows (alternativa open source a
 * Zapier/Make). En este proyecto se usa para enviar notificaciones
 * automáticas por WhatsApp y email cuando ocurre algo con una cita.
 *
 *  ┌──────────────┐    webhook    ┌──────────────┐
 *  │  Angular     │ ────────────► │  n8n         │
 *  │ (este client)│               │  workflow    │
 *  └──────────────┘               └──────┬───────┘
 *                                        │
 *                              ┌─────────┴─────────┐
 *                              ▼                   ▼
 *                       ┌──────────┐        ┌──────────┐
 *                       │ WhatsApp │        │  Email   │
 *                       │  WATI /  │        │ SendGrid │
 *                       │  Twilio  │        │ / Gmail  │
 *                       └──────────┘        └──────────┘
 *
 * Modos de operación:
 *   - 'disabled': no hace nada (cero requests, cero logs)
 *   - 'demo'    : loguea en consola + emite evento local (sin HTTP)
 *   - 'live'    : hace POST al webhook real de n8n
 */
@Injectable({ providedIn: 'root' })
export class N8nService {
  private http = inject(HttpClient);

  /** Auto-restaura config desde localStorage en cuanto se inyecta el servicio. */
  constructor() {
    this.restore();
  }

  /** Estado del servicio expuesto al panel admin. */
  readonly mode = signal<'disabled' | 'demo' | 'live'>('demo');
  readonly webhookUrl = signal<string>('');
  readonly lastResult = signal<NotificationResult | null>(null);
  readonly totalSent  = signal<number>(0);
  readonly totalErrors = signal<number>(0);

  /** Historial reciente (últimas 20) para mostrar en /gestion. */
  readonly history = signal<Array<NotificationPayload & { result: NotificationResult }>>([]);

  readonly isEnabled = computed(() => this.mode() !== 'disabled');
  readonly isLive    = computed(() => this.mode() === 'live');

  /**
   * Configura el servicio. Llamar desde /gestion o al iniciar.
   */
  configure(opts: { mode: 'disabled' | 'demo' | 'live'; webhookUrl?: string }): void {
    this.mode.set(opts.mode);
    if (opts.webhookUrl !== undefined) this.webhookUrl.set(opts.webhookUrl);
    this.persist();
  }

  /**
   * Persiste la configuración en localStorage para que sobreviva
   * recargas. Lee al construir (en el constructor vía restore()).
   */
  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        'barberschedule.n8n',
        JSON.stringify({ mode: this.mode(), webhookUrl: this.webhookUrl() }),
      );
    } catch { /* ignore quota errors */ }
  }

  /** Lee la configuración persistida. Llamar una vez al boot. */
  restore(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem('barberschedule.n8n');
      if (!raw) return;
      const cfg = JSON.parse(raw);
      if (cfg.mode) this.mode.set(cfg.mode);
      if (cfg.webhookUrl) this.webhookUrl.set(cfg.webhookUrl);
    } catch { /* ignore */ }
    try {
      const rawH = localStorage.getItem('barberschedule.n8n.history');
      if (!rawH) return;
      const hist = JSON.parse(rawH) as Array<NotificationPayload & { result: NotificationResult }>;
      if (Array.isArray(hist)) {
        this.history.set(hist);
        // Recalcular contadores desde el historial
        let sent = 0, errs = 0;
        for (const h of hist) {
          if (h.result.delivered) sent++;
          if (h.result.mode === 'error') errs++;
        }
        this.totalSent.set(sent);
        this.totalErrors.set(errs);
        if (hist.length > 0) this.lastResult.set(hist[0].result);
      }
    } catch { /* ignore */ }
  }

  private persistHistory(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        'barberschedule.n8n.history',
        JSON.stringify(this.history()),
      );
    } catch { /* ignore quota */ }
  }

  /**
   * Notifica un evento a n8n (o lo simula en modo demo).
   * Fire-and-forget: no bloquea la operación principal.
   */
  async notify(
    event: NotificationEvent,
    appointment: Appointment,
    metadata?: NotificationPayload['metadata'],
  ): Promise<NotificationResult> {
    const payload: NotificationPayload = {
      event,
      timestamp: new Date().toISOString(),
      appointment,
      metadata,
    };

    if (this.mode() === 'disabled') {
      const result: NotificationResult = {
        delivered: false,
        mode: 'disabled',
        message: 'Notificaciones desactivadas',
      };
      this.recordResult(payload, result);
      return result;
    }

    if (this.mode() === 'demo') {
      // Modo demo: solo logueamos. Útil para desarrollo y demos offline.
      console.log(
        '%c📨 [n8n DEMO]',
        'background:#2ba89a;color:white;padding:2px 6px;border-radius:4px;font-weight:bold',
        payload,
      );
      const result: NotificationResult = {
        delivered: true,
        mode: 'demo',
        message: `Demo: ${event} registrado (no se envió)`,
      };
      this.recordResult(payload, result);
      return result;
    }

    // Modo live: POST al webhook de n8n
    const url = this.webhookUrl();
    if (!url) {
      const result: NotificationResult = {
        delivered: false,
        mode: 'error',
        message: 'Webhook URL vacía',
      };
      this.recordResult(payload, result);
      return result;
    }

    try {
      await firstValueFrom(this.http.post(url, payload));
      const result: NotificationResult = {
        delivered: true,
        mode: 'live',
        message: `Notificación enviada a n8n`,
      };
      this.recordResult(payload, result);
      return result;
    } catch (e) {
      console.warn('n8n no respondió, la cita se creó igual:', e);
      const result: NotificationResult = {
        delivered: false,
        mode: 'error',
        message: 'n8n no disponible (cita guardada de todas formas)',
      };
      this.recordResult(payload, result);
      return result;
    }
  }

  private recordResult(payload: NotificationPayload, result: NotificationResult): void {
    this.lastResult.set(result);
    if (result.mode === 'error') this.totalErrors.update((n) => n + 1);
    if (result.delivered) this.totalSent.update((n) => n + 1);
    this.history.update((h) => [{ ...payload, result }, ...h].slice(0, 20));
    this.persistHistory();
  }

  /** Limpia el historial (botón en /gestion). */
  clearHistory(): void {
    this.history.set([]);
    this.totalSent.set(0);
    this.totalErrors.set(0);
    this.lastResult.set(null);
    this.persistHistory();
  }
}
