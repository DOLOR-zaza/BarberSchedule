import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ServiceCatalogService } from './service-catalog.service';
import { BarberService } from './barber.service';
import { environment } from '../../../environments/environment';

export type ChatRole = 'user' | 'bot';
export type ChatMode = 'rule-based' | 'ai';

export interface ChatMessage {
  id: number;
  role: ChatRole;
  text: string;
  quickReplies?: string[];
  suggestedServiceId?: number;
  suggestedBarberId?: number;
  /** Origen: 'rule-based' (local) o 'ai' (DeepSeek via n8n) */
  source?: 'rule-based' | 'ai';
  timestamp: Date;
}

export interface BotResponse {
  text: string;
  quickReplies?: string[];
  suggestedServiceId?: number;
  suggestedBarberId?: number;
}

interface ChatState {
  lastServiceId?: number;
  lastServiceName?: string;
  lastBarberId?: number;
  lastBarberName?: number | string;
  awaitingConfirmation?: boolean;
  lastTopic?: string;
}

function svcDur(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectService(
  text: string,
  catalog: { id: number; name: string; duration: number; price: number; icon: string }[],
) {
  const lower = norm(text);
  const ALIASES: Record<string, string[]> = {
    'Corte clásico':    ['corte', 'clasico', 'normal', 'basico', 'corte normal', 'corte clasico', 'corte tradicional', 'corte de pelo', 'cortar el pelo', 'me corto el pelo', 'rapar', 'rapado', 'rapada', 'militar', 'hongo', 'cola de pato', 'buzz'],
    'Corte degradado':  ['degradado', 'degrade', 'fade', 'desvanecido', 'mid fade', 'low fade', 'high fade', 'skin fade', 'fade bajo', 'fade medio', 'fade alto', 'taper', 'mullet', 'texturizado', 'desvanecido'],
    'Barba':            ['barba', 'bigote', 'patillas', 'barbilla', 'rasurado', 'afeitar', 'afeitado', 'rasurar', 'recortar barba', 'perfilado', 'perfilado de barba', 'mustache', 'bigotito'],
    'Corte + barba':    ['combo', 'paquete', 'corte y barba', 'los dos', 'ambos', 'corte con barba', 'paquete completo', 'todo', 'todo el servicio', 'corte y bigote', 'corte mas barba', 'combo completo'],
    'Tinte':            ['tinte', 'color', 'pintar', 'pintura', 'matiz', 'tono', 'rubio', 'cafe', 'rojo', 'azul', 'mechas', 'cambio de color', 'decolorar', 'decoloracion', 'rayos', 'highlights', 'balayage'],
    'Diseño':           ['diseno', 'dibujar', 'rayita', 'rayas', 'figura', 'tatuaje', 'linea', 'lineas', 'ceja', 'cejas', 'cejas', 'disenos', 'dibujo', 'trazos', 'calado', 'navajado'],
  };

  const nameMatches: { svc: typeof catalog[0]; len: number }[] = [];
  for (const s of catalog) {
    const n = norm(s.name);
    if (lower.includes(n)) {
      nameMatches.push({ svc: s, len: n.length });
    }
  }
  if (nameMatches.length > 0) {
    return nameMatches.sort((a, b) => b.len - a.len)[0].svc;
  }

  let best: typeof catalog[0] | null = null;
  let bestLen = 0;
  for (const s of catalog) {
    const aliases = ALIASES[s.name] ?? [];
    for (const a of aliases) {
      if (lower.includes(a) && a.length > bestLen) {
        bestLen = a.length;
        best = s;
      }
    }
  }
  return best;
}

function detectBarber(text: string, barbers: { id: number; name: string }[]) {
  const lower = norm(text);
  for (const b of barbers) {
    if (lower.includes(norm(b.name))) return b;
    if (lower.includes(norm(b.name.split(' ')[0]))) return b;
  }
  return null;
}

/**
 * Respuesta del workflow de n8n.
 */
interface AIResponse {
  text: string;
  action?: {
    type: 'navigate';
    path: string;
    queryParams?: Record<string, number>;
    label: string;
  } | null;
  toolUsed?: string;
}

@Injectable({ providedIn: 'root' })
export class ChatbotService {
  private catalog = inject(ServiceCatalogService);
  private barbers = inject(BarberService);
  private http    = inject(HttpClient);
  private router  = inject(Router);

  // ───── Estado público ─────
  private nextId = 1;
  readonly messages = signal<ChatMessage[]>([]);
  readonly isTyping = signal<boolean>(false);

  /** Modo actual: rule-based o AI (DeepSeek via n8n) */
  readonly mode = signal<ChatMode>(this.loadMode());

  /** URL del webhook de AI (separado del de notificaciones) */
  readonly aiWebhookUrl = signal<string>(this.loadWebhookUrl());

  /** Estado de la configuración AI */
  readonly aiEnabled = computed(() => !!this.aiWebhookUrl() && this.mode() === 'ai');

  private state: ChatState = {};

  // ───── Persistencia ─────
  private loadMode(): ChatMode {
    if (typeof localStorage === 'undefined') return 'rule-based';
    return (localStorage.getItem('barberschedule.chatMode') as ChatMode) || 'rule-based';
  }
  private loadWebhookUrl(): string {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem('barberschedule.aiWebhook') || '';
  }
  private saveMode(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('barberschedule.chatMode', this.mode());
  }
  private saveWebhookUrl(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('barberschedule.aiWebhook', this.aiWebhookUrl());
  }

  configure(opts: { mode?: ChatMode; webhookUrl?: string }): void {
    if (opts.mode !== undefined) { this.mode.set(opts.mode); this.saveMode(); }
    if (opts.webhookUrl !== undefined) { this.aiWebhookUrl.set(opts.webhookUrl); this.saveWebhookUrl(); }
  }

  // ───── API pública ─────
  initConversation(): void {
    if (this.messages().length > 0) return;
    this.respondWithDelay(() => {
      this.pushBot(
        '¡Hola! Soy BarberBot 💈 Estoy aquí para ayudarte con tu próxima cita.\n\n' +
        'Puedo decirte sobre servicios, precios, horarios, ayudarte a agendar o ' +
        'recomendarte algo según lo que buscas. ¿En qué te ayudo?',
        ['Quiero agendar', 'Ver precios', 'Recomiéndame algo', 'Horarios disponibles'],
        undefined,
        undefined,
        'rule-based',
      );
    });
  }

  processUserInput(input: string): void {
  const trimmed = input.trim();
  if (!trimmed) return;

  this.pushUser(trimmed);

  /**
   * V24 pública:
   * la consulta/modificación de citas existentes todavía no está
   * disponible sin autenticación.
   *
   * Interceptamos estos intents ANTES de enviarlos a n8n/DeepSeek,
   * para evitar que la IA prometa funciones administrativas o
   * solicite datos que la aplicación aún no puede verificar.
   */
  if (
    environment.useSupabase &&
    this.isRestrictedAppointmentIntent(trimmed)
  ) {
    this.respondWithDelay(
      () => this.handleRestrictedAppointmentIntent(trimmed),
      300,
    );
    return;
  }

  // Decidir qué handler usar
  if (this.mode() === 'ai' && this.aiWebhookUrl()) {
    void this.handleAI(trimmed);
  } else {
    this.respondWithDelay(() => this.handle(trimmed), 400);
  }
}


  /**
   * Detecta intenciones relacionadas con consultar o modificar
   * citas existentes.
   *
   * En V24 pública estas operaciones permanecen cerradas hasta
   * implementar autenticación y administración segura en V25.
   */
  private isRestrictedAppointmentIntent(input: string): boolean {
    const text = norm(input);

    const wantsCancel =
      /\b(cancelar|anular)\b/.test(text) ||
      text.includes('no puedo ir') ||
      text.includes('no voy a poder');

    const wantsEdit =
      text.includes('editar mi cita') ||
      text.includes('editar cita') ||
      text.includes('modificar mi cita') ||
      text.includes('modificar cita') ||
      text.includes('cambiar mi cita') ||
      text.includes('reagendar mi cita') ||
      text.includes('reagendar cita') ||
      text.includes('mover mi cita');

    const wantsToView =
      text.includes('mis citas') ||
      text.includes('ver mis citas') ||
      text.includes('consultar mis citas') ||
      text.includes('citas agendadas') ||
      text.includes('mis reservas') ||
      text.includes('ver mi cita') ||
      text.includes('buscar mi cita');

    const alreadyBooked =
      text.includes('ya tengo cita') ||
      text.includes('ya tengo una cita') ||
      text.includes('ya agende') ||
      text.includes('ya reserve') ||
      text.includes('ya quedo');

    return wantsCancel || wantsEdit || wantsToView || alreadyBooked;
  }

  /**
   * Respuesta segura para operaciones sobre citas existentes
   * en la versión pública.
   */
  private handleRestrictedAppointmentIntent(input: string): void {
    const text = norm(input);

    if (
      /\b(cancelar|anular)\b/.test(text) ||
      text.includes('no puedo ir') ||
      text.includes('no voy a poder')
    ) {
      this.pushBot(
        'La cancelación de citas existentes todavía no está disponible desde la versión pública. ' +
        'Si necesitas cancelar una reserva, comunícate directamente con la barbería.',
        ['Crear una nueva', 'Otra cosa'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (
      text.includes('editar mi cita') ||
      text.includes('editar cita') ||
      text.includes('modificar mi cita') ||
      text.includes('modificar cita') ||
      text.includes('cambiar mi cita') ||
      text.includes('reagendar mi cita') ||
      text.includes('reagendar cita') ||
      text.includes('mover mi cita')
    ) {
      this.pushBot(
        'La edición o reagendado de citas existentes todavía no está disponible desde la versión pública. ' +
        'Si necesitas cambiar una reserva, comunícate directamente con la barbería.',
        ['Crear una nueva', 'Otra cosa'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (
      text.includes('mis citas') ||
      text.includes('ver mis citas') ||
      text.includes('consultar mis citas') ||
      text.includes('citas agendadas') ||
      text.includes('mis reservas') ||
      text.includes('ver mi cita') ||
      text.includes('buscar mi cita')
    ) {
      this.pushBot(
        'Por privacidad, la versión pública no muestra la lista de citas existentes. ' +
        'Tu reserva sí queda registrada cuando completas el formulario.',
        ['Crear una nueva', 'Otra cosa'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (
      text.includes('ya tengo cita') ||
      text.includes('ya tengo una cita') ||
      text.includes('ya agende') ||
      text.includes('ya reserve') ||
      text.includes('ya quedo')
    ) {
      this.pushBot(
        '¡Genial! Tu cita quedó registrada. 💈 ' +
        'Si necesitas hacer algún cambio, comunícate directamente con la barbería.',
        ['Crear una nueva', 'Otra cosa'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    this.pushBot(
      'La gestión de citas existentes todavía no está disponible desde la versión pública.',
      ['Crear una nueva', 'Otra cosa'],
      undefined,
      undefined,
      'rule-based',
    );
  }

  buildFormLink(serviceId?: number, barberId?: number) {
    const q: Record<string, number> = {};
    if (serviceId) q['service'] = serviceId;
    if (barberId)  q['barber']  = barberId;
    return { path: '/nueva-cita', queryParams: q };
  }

  reset(): void {
    this.state = {};
    this.messages.set([]);
    this.initConversation();
  }

  /**
   * Helper: ejecuta una navegación desde una acción del AI.
   * Usa Angular Router (respeta el base-href en GitHub Pages).
   */
  executeAction(action: AIResponse['action']): void {
  if (!action || action.type !== 'navigate') return;

  // V24 pública: las rutas que requieren acceso a appointments
  // permanecen cerradas hasta implementar Auth/admin.
  if (
    environment.useSupabase &&
    (
      action.path === '/citas' ||
      action.path.startsWith('/citas/') ||
      action.path === '/gestion'
    )
  ) {
    this.router.navigate(['/inicio']);
    return;
  }

  const segments = action.path
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);

  this.router.navigate(segments, {
    queryParams: action.queryParams,
  });
}

  // ─────────────────────────────────────────────────────────
  //  AI HANDLER (DeepSeek via n8n)
  // ─────────────────────────────────────────────────────────
  private async handleAI(input: string): Promise<void> {
    this.isTyping.set(true);
    try {
      // Construir historial (últimos 10 mensajes en formato OpenAI)
      const history = this.messages()
        .filter((m) => m.id !== this.messages()[this.messages().length - 1]?.id) // excluir el que acabamos de pushear
        .slice(-10)
        .map((m) => ({
          role: m.role === 'user' ? 'user' as const : 'assistant' as const,
          content: m.text,
        }));

      const response = await firstValueFrom(
        this.http.post<AIResponse>(this.aiWebhookUrl(), {
          message: input,
          history,
        })
      );

      // Si n8n devuelve error (404, 500, etc), el body puede no ser JSON
      // válido y response puede ser null. Lo manejamos defensivamente.
      if (!response || !response.text) {
        console.warn('AI bot: respuesta vacía o sin campo "text". Response:', response);
        throw new Error('Respuesta vacía del bot AI');
      }

      const restrictedAction =
  environment.useSupabase &&
  response.action?.type === 'navigate' &&
  (
    response.action.path === '/citas' ||
    response.action.path.startsWith('/citas/') ||
    response.action.path === '/gestion'
  );

const text = restrictedAction
  ? 'La gestión de citas existentes no está disponible desde la versión pública. ' +
    'Puedo ayudarte a crear una nueva cita, ver servicios o conocer al equipo.'
  : response.text;

const action = restrictedAction ? null : response.action;

      // Renderizar la respuesta con quick replies + acción
      const quickReplies = action
        ? [action.label, 'Otra pregunta']
        : ['¿Algo más?', 'Reiniciar'];

      const suggestedServiceId = action?.queryParams?.['service'];
      const suggestedBarberId  = action?.queryParams?.['highlight'];

      this.pushBot(
        text,
        quickReplies,
        suggestedServiceId,
        suggestedBarberId,
        'ai',
      );

      // Si hay acción, ejecutar navegación después de 2.5s
      if (action) {
        setTimeout(() => this.executeAction(action), 2500);
      }
    } catch (e) {
      console.error('Error llamando al bot AI:', e);
      // Fallback al rule-based si falla
      this.pushBot(
        '⚠️ El bot AI no está disponible ahora. Te conecto con el modo básico.\n\n' +
        '¿En qué te ayudo?',
        ['Quiero agendar', 'Ver precios', 'Recomiéndame algo'],
        undefined,
        undefined,
        'rule-based',
      );

    } finally {
      this.isTyping.set(false);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  RULE-BASED HANDLER (el original)
  // ─────────────────────────────────────────────────────────
  private readonly quickReplyHandlers: Array<{ match: RegExp; handler: (input: string) => void }> = [
    { match: /^(ir al formulario|al formulario|vamos al form|ll[ée]vame al form|agendar ya|vamos a agendar|ir a agendar|empezar|comencemos|comenzar)$/i,
      handler: () => this.goToForm() },
    { match: /^(ir a citas|ver mis citas|ir a inicio|ir a barberos|ir a servicios|ir al inicio|ir a la barberia)$/i,
      handler: () => this.handleNavigation() },

    { match: /^(quiero agendar|agendar cita|s[ií] agendar|vamos|dale|perfecto|hacemos|sep[aá]ralo|ap[úu]ntalo)$/i,
      handler: () => this.goToForm() },
    { match: /^quiero (.+)$/i,
      handler: (input) => this.handleQuieroServicio(input) },
    { match: /^agendar (.+)$/i,
      handler: (input) => this.handleQuieroServicio(input) },
    { match: /^s[ií],?\s*(lo agendamos|agendar|hacemos)$/i,
      handler: () => this.goToForm() },
    { match: /^s[ií],?\s*ir al formulario/i,
      handler: () => this.goToForm() },
    { match: /^(s[ií] con [a-z]+|prefiero a [a-z]+|s[ií] con [a-z]+)$/i,
      handler: (input) => this.handleQuiereBarbero(input) },

    { match: /^(huecos hoy|disponibilidad hoy|para hoy|agendar para hoy)$/i,
      handler: () => this.handleHoy() },
    { match: /^(ma[ñn]ana|para ma[ñn]ana|mejor ma[ñn]ana)$/i,
      handler: () => this.handleManana() },
    { match: /^(s[áa]bado|el s[áa]bado|para el s[áa]bado)$/i,
      handler: () => this.handleSabado() },
    { match: /^(la pr[óo]xima semana|la siguiente semana|otro d[íi]a)$/i,
      handler: () => this.handleOtroDia() },
    { match: /^ver disponibilidad( general)?$/i,
      handler: () => this.handleDisponibilidad() },

    { match: /^ver (otros servicios|m[áa]s servicios|el resto)$/i,
      handler: () => this.handleListServices() },
    { match: /^ver todos los precios$/i,
      handler: () => this.handleListPrices() },
    { match: /^ver m[áa]s baratos$/i,
      handler: () => this.handleCheapest() },
    { match: /^otro( servicio)?$/i,
      handler: () => this.handleAnother() },
    { match: /^otro servicio$/i,
      handler: () => this.handleAnother() },
    { match: /^(recom[ié]endame algo m[áa]s|recomienda otro|recomendaci[óo]n|recomiendame otro)$/i,
      handler: () => this.recommendRandom() },
    { match: /^rec[íi]endame/i,
      handler: () => this.recommendRandom() },
    { match: /^recomiendame algo$/i,
      handler: () => this.recommendRandom() },

    { match: /^(cabello corto|corto|pelo corto)$/i,
      handler: () => this.recommendByHair('corto') },
    { match: /^(cabello largo|largo|pelo largo)$/i,
      handler: () => this.recommendByHair('largo') },
    { match: /^(ondulado|rizado|cabello rizado)$/i,
      handler: () => this.recommendByHair('rizado') },
    { match: /^(no s[ée],? sorpr[ée]ndeme|no se que|no tengo idea)$/i,
      handler: () => this.recommendRandom() },

    { match: /^(s[ií]|s[ií]!|si!|s[ií]+|s[íi]?i+!|dale|va|ok|okay|perfecto|genial|porfa|por favor|me encanta|me gusta|hag[áa]moslo|hacemos|sep[áa]ralo|ap[úu]ntalo|confirmo|de acuerdo|exacto|claro|obvio)$/i,
      handler: () => this.handleAffirmative() },
    { match: /^(no|nop|nel|mejor no|no quiero|cambiar|no gracias|ninguno)$/i,
      handler: () => this.handleNegative() },

    { match: /^(agendar antes de irme|antes de irme)$/i,
      handler: () => this.goToForm() },

    { match: /^(otra cosa|otra pregunta)$/i,
      handler: () => this.handleOtraPregunta() },
    { match: /^volver al inicio$/i,
      handler: () => this.handleVolverInicio() },
    { match: /^mejor otro (servicio|barbero)$/i,
      handler: () => this.handleListServices() },
    { match: /^preferir ver (a todos|equipo|barberos)$/i,
      handler: () => this.handleListBarbers() },
    { match: /^ver barberos$/i,
      handler: () => this.handleListBarbers() },
    { match: /^ver servicios$/i,
      handler: () => this.handleListServices() },
    { match: /^ver el equipo$/i,
      handler: () => this.handleListBarbers() },
    { match: /^conocer al equipo$/i,
      handler: () => this.handleListBarbers() },
    { match: /^ir a inicio$/i,
      handler: () => this.handleOtraPregunta() },
    { match: /^crear una nueva$/i,
      handler: () => this.goToForm() },
    { match: /^seguir aqu[íi]$/i,
      handler: () => this.handleOtraPregunta() },

    { match: /^calvo$/i,
      handler: () => this.recommendByHair('calvo') },
    { match: /^entresemana$/i,
      handler: () => this.recommendByHair('entresemana') },
  ];

  private handle(input: string): void {
    for (const qr of this.quickReplyHandlers) {
      if (qr.match.test(input)) {
        qr.handler(input);
        return;
      }
    }

    const text = norm(input);
    const catalog = this.catalog.services();
    const barbers = this.barbers.barbers();

    const intentCompra = ['quiero', 'deseo', 'me interesa', 'agendar', 'apartar', 'reservar', 'dar', 'ponme', 'sacame'];
    const svc = detectService(input, catalog);
    if (svc && intentCompra.some((w) => text.includes(w))) {
      this.state.lastServiceId = svc.id;
      this.state.lastServiceName = svc.name;
      this.state.awaitingConfirmation = true;
      this.state.lastTopic = 'service';
      this.pushBot(
        `¡Buena elección! ${svc.icon} **${svc.name}** dura ${svc.duration} min y cuesta $${svc.price}.\n\n` +
        `¿Lo agendamos? También puedes ver otros servicios o ir directo al formulario.`,
        ['Sí, agendar', 'Ver otros servicios', '¿Quién me atiende?'],
        svc.id,
        undefined,
        'rule-based',
      );
      return;
    }

    if (svc && /precio|cuesta|costo|cu[aá]nto|vale|tarifa/.test(text)) {
      this.pushBot(
        `${svc.icon} **${svc.name}** — $${svc.price} (${svcDur(svc.duration)}).\n\n¿Lo agendamos?`,
        ['Sí, agendar', 'Ver todos los precios', 'Otro servicio'],
        svc.id,
        undefined,
        'rule-based',
      );
      return;
    }

    if (svc) {
      this.state.lastServiceId = svc.id;
      this.state.lastServiceName = svc.name;
      this.state.awaitingConfirmation = true;
      this.pushBot(
        `¡Buena elección! ${svc.icon} **${svc.name}** dura ${svc.duration} min y cuesta $${svc.price}.\n\n` +
        `¿Lo agendamos?`,
        ['Sí, agendar', 'Ver otros servicios', 'Recomiéndame otro'],
        svc.id,
        undefined,
        'rule-based',
      );
      return;
    }

    const barber = detectBarber(input, barbers);
    if (barber && /con|para|quiero|atender|hacer|disponible/.test(text)) {
      this.state.lastBarberId = barber.id;
      this.state.lastBarberName = barber.name;
      this.pushBot(
        `💈 **${barber.name}** es parte de nuestro equipo. Lo puedes elegir al agendar.\n\n` +
        `¿Quieres ir al formulario con él pre-seleccionado?`,
        ['Sí, ir al formulario', 'Ver todos los barberos', 'Ver servicios'],
        undefined,
        barber.id,
        'rule-based',
      );
      return;
    }
    if (barber) {
      this.pushBot(
        `💈 Sí, **${barber.name}** es uno de nuestros barberos. ¿Quieres agendar con él?`,
        ['Ir al formulario', 'Ver barberos', 'Ver servicios'],
        undefined,
        barber.id,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'que tal', 'que onda', 'hi', 'hello', 'hey', 'que hubo', 'como estas'])) {
      this.pushBot(pick([
        '¡Hola! ¿Cómo estás? Listo para tu próximo corte. ✂️',
        '¡Buenas! Qué gusto saludarte. ¿En qué te ayudo?',
        '¡Hey! Bienvenido. ¿Quieres agendar, ver servicios o necesitas una recomendación?',
      ]), ['Quiero agendar', 'Ver precios', 'Recomiéndame algo'], undefined, undefined, 'rule-based');
      return;
    }

    if (this.matchIntent(text, ['adios', 'bye', 'chao', 'chau', 'hasta luego', 'nos vemos', 'hasta pronto', 'hasta la vista', 'me voy'])) {
      this.pushBot(pick([
        '¡Hasta luego! Cualquier cosa, aquí ando 💈',
        '¡Nos vemos! Gracias por la charla. Que te quede increíble ese corte. ✂️',
        '¡Chao! Te espero cuando quieras reservar. 🤖',
      ]), ['Agendar antes de irme', 'Ver servicios'], undefined, undefined, 'rule-based');
      return;
    }

    if (this.matchIntent(text, ['agendar', 'reservar', 'apartar', 'sacar cita', 'pedir cita', 'me apunto', 'anotar', 'agenda cita'])) {
      this.pushBot(
        '¡Excelente! Para agendar necesito saber qué servicio te interesa. ' +
        'Tenemos corte clásico, degradado, barba, corte+barba, tinte y diseños.\n\n' +
        'O dime qué tienes en mente y te ayudo a elegir.',
        catalog.map((s) => `${s.icon} ${s.name}`),
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['precio', 'precios', 'cuesta', 'cuestan', 'costo', 'costos', 'cuanto', 'cuanto cuesta', 'cuanto sale', 'tarifa', 'tarifas', 'lista de precios', 'cuanto cobran', 'cobran'])) {
      this.handleListPrices();
      return;
    }

    if (this.matchIntent(text, ['dura', 'duracion', 'cuanto dura', 'cuanto tiempo', 'tarda', 'demora', 'minutos', 'rapido', 'cuanto se tarda'])) {
      this.pushBot(`Estos son los tiempos aproximados:\n\n` +
        catalog.map((s) => `${s.icon} ${s.name}: ${svcDur(s.duration)}`).join('\n') +
        `\n\n¿Cuál te interesa?`,
        catalog.map((s) => s.name),
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['horario', 'horarios', 'a que hora', 'cuando', 'abren', 'cierran', 'atienden', 'disponibilidad', 'turno'])) {
      this.handleHorarios();
      return;
    }

    if (this.matchIntent(text, ['hoy', 'ahora', 'en este momento'])) {
      this.handleHoy();
      return;
    }

    if (this.matchIntent(text, ['manana', 'el dia de manana', 'en 24 horas'])) {
      this.handleManana();
      return;
    }

    if (this.matchIntent(text, ['fin de semana', 'finde', 'sabado', 'sabados', 'domingo', 'domingos'])) {
      this.handleSabado();
      return;
    }

    if (this.matchIntent(text, ['barbero', 'barberos', 'equipo', 'staff', 'quien', 'quienes', 'quienes son', 'quienes me atienden'])) {
      this.handleListBarbers();
      return;
    }

    if (this.matchIntent(text, ['especialista', 'especialistas', 'especialidad', 'mejor barbero', 'experto', 'quien me recomienda', 'quien es bueno', 'el mejor'])) {
      this.recommendBarber();
      return;
    }

    if (this.matchIntent(text, ['recomendar', 'recomienda', 'recomiendame', 'sugerir', 'sugieres', 'sugiérame', 'sugerencia', 'que me recomiendas', 'que me hago', 'no se que', 'no se que hacerme', 'sorprendeme', 'sorprendeme'])) {
      this.recommendRandom();
      return;
    }

    if (this.matchIntent(text, ['cancelar', 'anular', 'no puedo ir', 'no voy a poder'])) {
  if (environment.useSupabase) {
    this.pushBot(
      'La cancelación de citas existentes todavía no está disponible desde la versión pública. ' +
      'Si necesitas cancelar una reserva, comunícate directamente con la barbería.',
      ['Crear una nueva', 'Otra cosa'],
      undefined,
      undefined,
      'rule-based',
    );
  } else {
    this.pushBot(
      'Para cancelar o modificar una cita, ve a **Citas** en el menú, busca la tuya y usa el botón "Cancelar".\n\n' +
      '¿Quieres que te lleve?',
      ['Ir a Citas', 'Otra cosa'],
      undefined,
      undefined,
      'rule-based',
    );
  }
  return;
}

    if (this.matchIntent(text, ['cambiar', 'modificar', 'reagendar', 'mover', 'editar cita'])) {
  if (environment.useSupabase) {
    this.pushBot(
      'La edición o reagendado de citas existentes todavía no está disponible desde la versión pública. ' +
      'Si necesitas cambiar una reserva, comunícate directamente con la barbería.',
      ['Crear una nueva', 'Otra cosa'],
      undefined,
      undefined,
      'rule-based',
    );
  } else {
    this.pushBot(
      'Para cambiar fecha u hora, ve a **Citas** y usa el botón "Editar" en la card correspondiente.',
      ['Ir a Citas', 'Otra cosa'],
      undefined,
      undefined,
      'rule-based',
    );
  }
  return;
}

    if (this.matchIntent(text, ['mis citas', 'citas agendadas', 'lo que tengo', 'que tengo', 'mis reservas'])) {
  if (environment.useSupabase) {
    this.pushBot(
      'Por privacidad, la versión pública no muestra la lista de citas existentes. ' +
      'Tu reserva sí queda registrada cuando completas el formulario.',
      ['Crear una nueva', 'Otra cosa'],
      undefined,
      undefined,
      'rule-based',
    );
  } else {
    this.pushBot(
      'En la página **Citas** puedes ver, filtrar y editar todas tus reservas. ¿Te llevo?',
      ['Ir a Citas', 'Crear una nueva'],
      undefined,
      undefined,
      'rule-based',
    );
  }
  return;
}

    if (this.matchIntent(text, ['pago', 'pagos', 'pagar', 'cobro', 'efectivo', 'tarjeta', 'transferencia', 'metodo de pago', 'como pago', 'aceptan'])) {
      this.pushBot(
        '💳 **Formas de pago**\n\n' +
        'Aceptamos efectivo, tarjeta de débito/crédito y transferencia.\n\n' +
        'El pago se realiza al finalizar el servicio en la barbería.',
        ['Ir a agendar', 'Ver precios'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['ubicacion', 'direccion', 'donde', 'donde estan', 'como llegar', 'llegar', 'mapa'])) {
      this.pushBot(
        '📍 Estamos en el centro de la ciudad. La dirección exacta te la mandamos por WhatsApp al confirmar tu cita.\n\n' +
        '¿Quieres agendar y te la enviamos?',
        ['Sí, agendar', 'Otra cosa'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['contacto', 'telefono', 'whatsapp', 'email', 'correo', 'humano', 'persona real'])) {
      this.pushBot(
        '📞 **Contacto**\n\n' +
        'WhatsApp: +52 555 010 1010\n' +
        'Email: hola@barberschedule.app',
        ['Seguir aquí', 'Ver servicios'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['como funciona', 'como uso', 'que hace', 'de que sirve', 'para que sirve', 'ayuda', 'help', 'no entiendo'])) {
      this.pushBot(
        '🛠️ **Cómo funciona BarberSchedule**\n\n' +
        '1️⃣ Elige un servicio (corte, barba, tinte, etc.)\n' +
        '2️⃣ Selecciona barbero, fecha y hora\n' +
        '3️⃣ Confirma tus datos de contacto\n' +
        '4️⃣ ¡Listo!',
        ['Ir a agendar', 'Ver servicios'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['cabello largo', 'pelo largo', 'largo', 'cabello corto', 'pelo corto', 'corto', 'rizado', 'liso', 'ondulado'])) {
      this.recommendByHair(text);
      return;
    }

    if (this.matchIntent(text, ['boda', 'evento', 'fiesta', 'graduacion', 'cumpleanos', 'primera cita', 'entrevista', 'trabajo', 'oficina'])) {
      this.pushBot(
        '💍 Para una ocasión especial te recomiendo **Corte degradado** + **Barba** (Combo). ' +
        '¿Lo agendamos?',
        ['Sí, agendar combo', 'Ver opciones', 'Otra recomendación'],
        this.catalog.services().find((s) => s.name === 'Corte + barba')?.id,
        undefined,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['urgente', 'urgencia', 'rapido', 'lo antes posible', 'hoy mismo', 'para ya', 'apurale'])) {
      this.pushBot(
        '⚡ Para algo rápido, el **Corte clásico** (30 min, $120) o solo **Barba** (30 min, $100) son los más ágiles. ' +
        '¿Cuál prefieres?',
        ['Corte clásico', 'Solo barba', 'Combo completo'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['gracias', 'grax', 'graxx', 'thanks', 'thx', 'ty', 'merci', 'mil gracias'])) {
      this.pushBot(pick([
        '¡De nada! Aquí ando cuando necesites. 💈',
        '¡Un placer! Cualquier otra duda, pregunta sin pena.',
        '¡Para eso estamos!',
      ]), ['Agendar ahora', 'Ver servicios'], undefined, undefined, 'rule-based');
      return;
    }

    if (this.matchIntent(text, ['tonto', 'malo', 'no sirves', 'inutil', 'estupido', 'pendejo', 'cabron', 'idiota', 'menso'])) {
      this.pushBot(
        '😬 Soy un bot con reglas, no me ofendo pero no me ayudas. ' +
        '¿Quieres que te ayude a agendar o ver precios?',
        ['Ver precios', 'Agendar cita'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['quien eres', 'que eres', 'eres real', 'eres humano', 'eres bot', 'eres ia', 'como te llamas', 'tu nombre'])) {
      this.pushBot(
        '🤖 Soy **BarberBot**, un asistente virtual con reglas. No soy IA real, ' +
        'estoy entrenado para ayudarte con la barbería. ¿En qué te ayudo?',
        ['Agendar cita', 'Ver servicios'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (this.matchIntent(text, ['ya agende', 'ya tengo cita', 'ya reserve', 'ya quedo', 'ya agendo'])) {
  if (environment.useSupabase) {
    this.pushBot(
      '¡Genial! Tu cita quedó registrada. 💈 Si necesitas hacer algún cambio, comunícate directamente con la barbería.',
      ['Crear una nueva', 'Otra cosa'],
      undefined,
      undefined,
      'rule-based',
    );
  } else {
    this.pushBot(
      '¡Genial! Si quieres ver, editar o cancelar, ve a **Citas**. ¿Te llevo?',
      ['Ir a Citas', 'Otra cosa'],
      undefined,
      undefined,
      'rule-based',
    );
  }
  return;
}

    if (this.matchIntent(text, ['http', 'www', 'instagram', 'facebook', 'tiktok', 'twitter', 'redes'])) {
      this.pushBot(
        '📱 Síguenos como **@BarberSchedule**. ¿Necesitas algo más?',
        ['Ver servicios', 'Agendar'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    if (input.includes('?') || input.includes('¿')) {
      this.pushBot(
        'Buena pregunta, pero ese tema se me escapa. Te puedo ayudar con: agendar, precios, servicios, horarios, equipo o recomendaciones.\n\n' +
        '¿Cuál te interesa?',
        ['Precios', 'Horarios', 'Agendar', 'Recomendación'],
        undefined,
        undefined,
        'rule-based',
      );
      return;
    }

    this.pushBot(
      '🤔 No te cacho. Puedo ayudarte con:\n\n' +
      '• Agendar una cita\n' +
      '• Ver precios y servicios\n' +
      '• Conocer al equipo\n' +
      '• Recomendarte un look\n' +
      '• Decirte cómo funciona la app\n\n' +
      '¿Por dónde le entramos?',
      ['Agendar cita', 'Ver precios', 'Conocer al equipo', 'Recomiéndame algo'],
      undefined,
      undefined,
      'rule-based',
    );
  }

  private goToForm(): void {
    if (this.state.lastServiceId || this.state.lastBarberId) {
      this.pushBot(
        `¡Va! Te llevo al formulario con todo pre-seleccionado. ✨`,
        ['Otra recomendación', 'Ver servicios'],
        this.state.lastServiceId,
        this.state.lastBarberId,
        'rule-based',
      );
    } else {
      this.pushBot(
        '¡Va! Elige primero un servicio para que te lo deje listo. ' +
        'Estos son los disponibles:',
        this.catalog.services().map((s) => `${s.icon} ${s.name}`),
        undefined,
        undefined,
        'rule-based',
      );
    }
  }

  private handleQuieroServicio(input: string): void {
    const catalog = this.catalog.services();
    const m = input.match(/^(?:quiero|agendar)\s+(.+)$/i);
    if (!m) return;
    const query = norm(m[1]);
    const svc = detectService(query, catalog);
    if (svc) {
      this.state.lastServiceId = svc.id;
      this.state.lastServiceName = svc.name;
      this.pushBot(
        `¡Buena elección! ${svc.icon} **${svc.name}** dura ${svc.duration} min y cuesta $${svc.price}. ¿Lo agendamos?`,
        ['Sí, agendar', 'Ver otros servicios', 'Recomiéndame otro'],
        svc.id,
        undefined,
        'rule-based',
      );
    } else {
      this.pushBot(
        `No identifiqué "${m[1]}" como un servicio. Estos son los que tenemos:`,
        catalog.map((s) => `${s.icon} ${s.name}`),
        undefined,
        undefined,
        'rule-based',
      );
    }
  }

  private handleQuiereBarbero(input: string): void {
    const barbers = this.barbers.barbers();
    const m = input.match(/s[ií],?\s*con\s+([a-záéíóúñ]+)/i);
    if (!m) return;
    const nameQuery = m[1];
    const b = barbers.find((b) => norm(b.name).startsWith(nameQuery) || norm(b.name.split(' ')[0]) === nameQuery);
    if (b) {
      this.state.lastBarberId = b.id;
      this.state.lastBarberName = b.name;
      this.pushBot(
        `Va, con **${b.name}**. Te llevo al formulario.`,
        ['Otra recomendación', 'Ver servicios'],
        this.state.lastServiceId,
        b.id,
        'rule-based',
      );
    } else {
      this.handleListBarbers();
    }
  }

  private handleNavigation(): void {
  if (environment.useSupabase) {
    this.pushBot(
      '📍 Puedo llevarte a:\n\n' +
      '• **Servicios** — ver catálogo\n' +
      '• **Barberos** — conocer al equipo\n' +
      '• **Inicio** — página principal\n\n' +
      'También puedo ayudarte a agendar una nueva cita.',
      ['Ir al formulario', 'Ver servicios', 'Ver barberos', 'Ir a inicio'],
      undefined,
      undefined,
      'rule-based',
    );
    return;
  }

  this.pushBot(
    '📍 Puedo llevarte a:\n\n' +
    '• **Citas** — ver/editar/cancelar\n' +
    '• **Servicios** — ver catálogo\n' +
    '• **Barberos** — conocer al equipo\n' +
    '• **Inicio** — dashboard\n\n' +
    '¿A cuál vamos?',
    ['Ir a Citas', 'Ver servicios', 'Ver barberos', 'Ir a inicio'],
    undefined,
    undefined,
    'rule-based',
  );
}

  private handleHorarios(): void {
    this.pushBot(
      '📅 **Horarios de atención**\n\n' +
      '🕙 Lunes a viernes: 10:00 — 20:00\n' +
      '🕙 Sábado: 10:00 — 18:00\n' +
      '🚫 Domingo: cerrado\n\n' +
      '¿Quieres que te muestre los huecos disponibles?',
      ['Huecos hoy', 'Mañana', 'Sábado', 'La próxima semana'],
      undefined,
      undefined,
      'rule-based',
    );
  }

  private handleHoy(): void {
    this.pushBot(
      '¿Para hoy? Lo más rápido es ir al formulario y elegir horario. ' +
      'Los huecos ocupados se tachan automáticamente.',
      ['Ir al formulario', 'Mejor mañana', 'Ver disponibilidad general'],
      undefined,
      undefined,
      'rule-based',
    );
  }

  private handleManana(): void {
    this.pushBot(
      'Mañana es buena opción. Te llevo al formulario donde puedes elegir el día y la hora exactos.',
      ['Ir al formulario', 'Ver horarios primero', 'Mejor otro día'],
      undefined,
      undefined,
      'rule-based',
    );
  }

  private handleSabado(): void {
    this.pushBot(
      '🗓️ Trabajamos el **sábado de 10:00 a 18:00**. Los domingos descansamos. ' +
      '¿Te llevo al formulario?',
      ['Ir al formulario', 'Ver servicios', 'Mejor lunes'],
      undefined,
      undefined,
      'rule-based',
    );
  }

  private handleOtroDia(): void {
    this.pushBot(
      'La próxima semana tenemos huecos de lunes a sábado. ' +
      'Ve al formulario y elige el día que prefieras.',
      ['Ir al formulario', 'Ver servicios', 'Mejor otro día'],
      undefined,
      undefined,
      'rule-based',
    );
  }

  private handleDisponibilidad(): void {
    this.pushBot(
      '📊 La disponibilidad se muestra en tiempo real en el formulario de agendar — ' +
      'los slots ya ocupados aparecen tachados.\n\n' +
      '¿Vamos al formulario?',
      ['Ir al formulario', 'Ver servicios', 'Otra cosa'],
      undefined,
      undefined,
      'rule-based',
    );
  }

  private handleListServices(): void {
    const catalog = this.catalog.services();
    this.pushBot(
      '💈 **Nuestros servicios**\n\n' +
      catalog.map((s) => `${s.icon} ${s.name} — $${s.price} · ${svcDur(s.duration)}`).join('\n') +
      '\n\n¿Cuál te interesa?',
      catalog.map((s) => `Quiero ${s.name}`),
      undefined,
      undefined,
      'rule-based',
    );
  }

  private handleListPrices(): void {
    this.handleListServices();
  }

  private handleCheapest(): void {
    const cheapest = [...this.catalog.services()].sort((a, b) => a.price - b.price).slice(0, 3);
    this.pushBot(
      '💰 Los más accesibles:\n\n' +
      cheapest.map((s) => `${s.icon} **${s.name}** — $${s.price} · ${svcDur(s.duration)}`).join('\n'),
      cheapest.map((s) => `Quiero ${s.name}`),
      undefined,
      undefined,
      'rule-based',
    );
  }

  private handleAnother(): void {
    this.handleListServices();
  }

  private handleListBarbers(): void {
    const list = this.barbers.barbers()
      .map((b) => `💈 ${b.name} — ${b.specialty} (${b.experience} años)`)
      .join('\n');
    this.pushBot(`Nuestro equipo:\n\n${list}\n\n¿Quiero agendar con alguno?`,
      this.barbers.barbers().map((b) => `Sí, con ${b.name.split(' ')[0]}`),
      undefined,
      undefined,
      'rule-based',
    );
  }

  private recommendBarber(): void {
    const top = this.barbers.barbers()[0];
    this.state.lastBarberId = top.id;
    this.state.lastBarberName = top.name;
    this.pushBot(
      `💈 Te recomiendo a **${top.name}** (${top.specialty}, ${top.experience} años). ` +
      `¿Lo agendamos?`,
      ['Sí, con él', 'Ver barberos', 'Otra recomendación'],
      undefined,
      top.id,
      'rule-based',
    );
  }

  private recommendRandom(): void {
    const opts = [
      () => this.recommendByMood('formal'),
      () => this.recommendByMood('casual'),
      () => this.recommendByMood('cambio'),
      () => this.recommendTopService(),
    ];
    pick(opts)();
  }

  private recommendByMood(mood: 'formal' | 'casual' | 'cambio'): void {
    const map = {
      formal:  { svc: 'Corte degradado',    why: 'Limpio y profesional' },
      casual:  { svc: 'Corte clásico',      why: 'Atemporal y fácil de mantener' },
      cambio:  { svc: 'Diseño',             why: 'Para verte diferente sin cambiar tu look' },
    };
    const r = map[mood];
    const svc = this.catalog.services().find((s) => s.name === r.svc);
    if (!svc) return;
    this.state.lastServiceId = svc.id;
    this.state.lastServiceName = svc.name;
    this.pushBot(
      `Si buscas algo **${mood}**, te recomiendo **${svc.icon} ${svc.name}** — ${r.why}. ` +
      `Dura ${svc.duration} min y cuesta $${svc.price}. ¿Lo agendamos?`,
      ['Sí, agendar', 'Otra recomendación', 'Ver precios'],
      svc.id,
      undefined,
      'rule-based',
    );
  }

  private recommendTopService(): void {
    const top = [...this.catalog.services()].sort((a, b) => b.price - a.price)[0];
    this.state.lastServiceId = top.id;
    this.state.lastServiceName = top.name;
    this.pushBot(
      `Nuestro servicio top es **${top.icon} ${top.name}** (${svcDur(top.duration)}, $${top.price}). ` +
      '¿Lo agendamos?',
      ['Sí, agendar', 'Ver más baratos', 'Otra recomendación'],
      top.id,
      undefined,
      'rule-based',
    );
  }

  private recommendByHair(hair: string): void {
    const text = norm(hair);
    let svc;
    if (text.includes('largo')) {
      svc = this.catalog.services().find((s) => s.name === 'Corte degradado');
    } else if (text.includes('corto')) {
      svc = this.catalog.services().find((s) => s.name === 'Corte clásico');
    } else if (text.includes('rizado') || text.includes('ondulado')) {
      svc = this.catalog.services().find((s) => s.name === 'Corte degradado');
    } else if (text.includes('calvo')) {
      svc = this.catalog.services().find((s) => s.name === 'Barba');
    } else {
      svc = this.catalog.services()[0];
    }
    if (!svc) return;
    this.state.lastServiceId = svc.id;
    this.state.lastServiceName = svc.name;
    this.pushBot(
      `Para cabello ${hair} te recomiendo **${svc.icon} ${svc.name}** (${svcDur(svc.duration)}, $${svc.price}). ` +
      '¿Lo agendamos?',
      ['Sí, agendar', 'Otra recomendación', 'Ver servicios'],
      svc.id,
      undefined,
      'rule-based',
    );
  }

  private handleAffirmative(): void {
    if (this.state.lastServiceId) {
      this.pushBot(
        `¡Perfecto! Te llevo al formulario con **${this.state.lastServiceName}** pre-seleccionado. ✨`,
        ['Otra recomendación', 'Ver servicios'],
        this.state.lastServiceId,
        this.state.lastBarberId,
        'rule-based',
      );
    } else if (this.state.lastBarberId) {
      this.pushBot(
        `Va. Te llevo al formulario con **${this.state.lastBarberName}** pre-seleccionado.`,
        ['Otra recomendación', 'Ver servicios'],
        undefined,
        this.state.lastBarberId,
        'rule-based',
      );
    } else {
      this.pushBot('¿Qué quieres hacer?', ['Agendar cita', 'Ver precios', 'Recomiéndame algo'], undefined, undefined, 'rule-based');
    }
  }

  private handleNegative(): void {
    this.pushBot(
      'No hay drama. ¿Qué te gustaría ver en su lugar?',
      ['Ver todos los servicios', 'Ver otros barberos', 'Recomiéndame algo'],
      undefined,
      undefined,
      'rule-based',
    );
  }

  private handleOtraPregunta(): void {
    this.pushBot(
      '¿En qué más te ayudo?',
      ['Agendar cita', 'Ver precios', 'Horarios', 'Recomiéndame algo'],
      undefined,
      undefined,
      'rule-based',
    );
  }

  private handleVolverInicio(): void {
    this.handleOtraPregunta();
  }

  private matchIntent(text: string, keywords: string[]): boolean {
    return keywords.some((k) => text.includes(norm(k)));
  }

  private respondWithDelay(action: () => void, delay = 600): void {
    this.isTyping.set(true);
    setTimeout(() => {
      action();
      this.isTyping.set(false);
    }, delay);
  }

  private pushUser(text: string) {
    this.messages.update((m) => [
      ...m,
      { id: this.nextId++, role: 'user', text, timestamp: new Date() },
    ]);
  }

  private pushBot(
    text: string,
    quickReplies?: string[],
    suggestedServiceId?: number,
    suggestedBarberId?: number,
    source: 'rule-based' | 'ai' = 'rule-based',
  ) {
    this.messages.update((m) => [
      ...m,
      {
        id: this.nextId++,
        role: 'bot',
        text,
        quickReplies,
        suggestedServiceId,
        suggestedBarberId,
        source,
        timestamp: new Date(),
      },
    ]);
  }
}
