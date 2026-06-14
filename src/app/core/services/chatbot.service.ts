import { Injectable, inject, signal } from '@angular/core';
import { ServiceCatalogService } from './service-catalog.service';
import { BarberService } from './barber.service';

export type ChatRole = 'user' | 'bot';

export interface ChatMessage {
  id: number;
  role: ChatRole;
  text: string;
  quickReplies?: string[];
  suggestedServiceId?: number;
  suggestedBarberId?: number;
  timestamp: Date;
}

export interface BotResponse {
  text: string;
  quickReplies?: string[];
  suggestedServiceId?: number;
  suggestedBarberId?: number;
}

// ─────────────────────────────────────────────────────────────────
//  ESTADO DE CONVERSACIÓN — el bot "recuerda"
// ─────────────────────────────────────────────────────────────────
interface ChatState {
  lastServiceId?: number;
  lastServiceName?: string;
  lastBarberId?: number;
  lastBarberName?: number | string;
  awaitingConfirmation?: boolean;
  lastTopic?: string;
}

// ─────────────────────────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────────────────────────
function svcDur(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Normaliza: lowercase + sin acentos + sin espacios extra */
function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // quita acentos
    .replace(/[¿?¡!.,;:]/g, ' ')       // quita signos
    .replace(/\s+/g, ' ')
    .trim();
}

/** Detecta servicio por nombre o alias (con normalización) */
function detectService(
  text: string,
  catalog: { id: number; name: string; duration: number; price: number; icon: string }[],
) {
  const lower = norm(text);
  const ALIASES: Record<string, string[]> = {
    'Corte clásico':    ['corte', 'clasico', 'normal', 'basico', 'corte normal', 'corte clasico'],
    'Corte degradado':  ['degradado', 'degrade', 'fade', 'desvanecido', 'mid fade', 'low fade', 'high fade', 'skin fade'],
    'Barba':            ['barba', 'bigote', 'patillas', 'barbilla', 'rasurado', 'afeitar', 'afeitado'],
    'Corte + barba':    ['combo', 'paquete', 'corte y barba', 'los dos', 'ambos', 'corte con barba'],
    'Tinte':            ['tinte', 'color', 'pintar', 'pintura', 'matiz', 'tono', 'rubio', 'cafe', 'rojo', 'azul', 'mechas'],
    'Diseño':           ['diseno', 'dibujar', 'rayita', 'rayas', 'figura', 'tatuaje', 'linea'],
  };

  // 1) Recolectar TODAS las coincidencias por nombre con su longitud
  const nameMatches: { svc: typeof catalog[0]; len: number }[] = [];
  for (const s of catalog) {
    const n = norm(s.name);
    if (lower.includes(n)) {
      nameMatches.push({ svc: s, len: n.length });
    }
  }
  if (nameMatches.length > 0) {
    // Devolver la coincidencia MÁS LARGA (más específica)
    return nameMatches.sort((a, b) => b.len - a.len)[0].svc;
  }

  // 2) Si no hay match por nombre, buscar por alias — también el más largo
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

// ─────────────────────────────────────────────────────────────────
//  SERVICIO
// ─────────────────────────────────────────────────────────────────
@Injectable({ providedIn: 'root' })
export class ChatbotService {
  private catalog = inject(ServiceCatalogService);
  private barbers = inject(BarberService);

  private nextId = 1;
  readonly messages = signal<ChatMessage[]>([]);
  readonly isTyping = signal<boolean>(false);
  private state: ChatState = {};

  // ───── API PÚBLICA ─────
  initConversation(): void {
    if (this.messages().length > 0) return;
    this.respondWithDelay(() => {
      this.pushBot(
        '¡Hola! Soy BarberBot 💈 Estoy aquí para ayudarte con tu próxima cita.\n\n' +
        'Puedo decirte sobre servicios, precios, horarios, ayudarte a agendar o ' +
        'recomendarte algo según lo que buscas. ¿En qué te ayudo?',
        ['Quiero agendar', 'Ver precios', 'Recomiéndame algo', 'Horarios disponibles'],
      );
    });
  }

  processUserInput(input: string): void {
    const trimmed = input.trim();
    if (!trimmed) return;
    this.pushUser(trimmed);
    this.respondWithDelay(() => this.handle(trimmed));
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

  // ─────────────────────────────────────────────────────────
  //  ⭐ FIX PRINCIPAL: mapa de quick replies → handler
  //  Cada chip que el bot sugiere tiene un handler dedicado
  // ─────────────────────────────────────────────────────────
  private readonly quickReplyHandlers: Array<{ match: RegExp; handler: (input: string) => void }> = [
    // ── NAVEGACIÓN ──
    { match: /^(ir al formulario|al formulario|vamos al form|ll[ée]vame al form|agendar ya|vamos a agendar|ir a agendar|empezar|comencemos|comenzar)$/i,
      handler: () => this.goToForm() },
    { match: /^(ir a citas|ver mis citas|ir a inicio|ir a barberos|ir a servicios|ir al inicio|ir a la barberia)$/i,
      handler: () => this.handleNavigation() },

    // ── SELECCIÓN DE SERVICIO (chips) ──
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

    // ── CHIPS DE HORARIOS ──
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

    // ── CHIPS DE SERVICIOS ──
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

    // ── CHIPS DE CABELLOS ──
    { match: /^(cabello corto|corto|pelo corto)$/i,
      handler: () => this.recommendByHair('corto') },
    { match: /^(cabello largo|largo|pelo largo)$/i,
      handler: () => this.recommendByHair('largo') },
    { match: /^(ondulado|rizado|cabello rizado)$/i,
      handler: () => this.recommendByHair('rizado') },
    { match: /^(no s[ée],? sorpr[ée]ndeme|no se que|no tengo idea)$/i,
      handler: () => this.recommendRandom() },

    // ── RESPUESTAS AFIRMATIVAS / NEGATIVAS ──
    { match: /^(s[ií]|s[ií]!|si!|s[ií]+|s[íi]?i+!|dale|va|ok|okay|perfecto|genial|porfa|por favor|me encanta|me gusta|hag[áa]moslo|hacemos|sep[áa]ralo|ap[úu]ntalo|confirmo|de acuerdo|exacto|claro|obvio)$/i,
      handler: () => this.handleAffirmative() },
    { match: /^(no|nop|nel|mejor no|no quiero|cambiar|no gracias|ninguno)$/i,
      handler: () => this.handleNegative() },

    // ── DESPEDIDAS ──
    { match: /^(agendar antes de irme|antes de irme)$/i,
      handler: () => this.goToForm() },

    // ── NAVEGACIÓN A CATS ──
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

    // ── ESTILO DE CABELLOS ──
    { match: /^calvo$/i,
      handler: () => this.recommendByHair('calvo') },
    { match: /^entresemana$/i,
      handler: () => this.recommendByHair('entresemana') },
  ];

  // ─────────────────────────────────────────────────────────
  //  NÚCLEO: handle() con 4 niveles de fallback
  // ─────────────────────────────────────────────────────────
  private handle(input: string): void {
    // 1) PRIMERO: intentar matchear como quick reply (súper específico)
    for (const qr of this.quickReplyHandlers) {
      if (qr.match.test(input)) {
        qr.handler(input);
        return;
      }
    }

    const text = norm(input);
    const catalog = this.catalog.services();
    const barbers = this.barbers.barbers();

    // 2) Detección de servicio (con keywords de intención de compra)
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
      );
      return;
    }

    if (svc && /precio|cuesta|costo|cu[aá]nto|vale|tarifa/.test(text)) {
      this.pushBot(
        `${svc.icon} **${svc.name}** — $${svc.price} (${svcDur(svc.duration)}).\n\n¿Lo agendamos?`,
        ['Sí, agendar', 'Ver todos los precios', 'Otro servicio'],
        svc.id,
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
      );
      return;
    }

    // 3) Detección de barbero
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
      );
      return;
    }
    if (barber) {
      this.pushBot(
        `💈 Sí, **${barber.name}** es uno de nuestros barberos. ¿Quieres agendar con él?`,
        ['Ir al formulario', 'Ver barberos', 'Ver servicios'],
        undefined,
        barber.id,
      );
      return;
    }

    // 4) Intenciones generales (orden de prioridad)
    if (this.matchIntent(text, ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'que tal', 'que onda', 'hi', 'hello', 'hey', 'que hubo', 'como estas'])) {
      this.pushBot(pick([
        '¡Hola! ¿Cómo estás? Listo para tu próximo corte. ✂️',
        '¡Buenas! Qué gusto saludarte. ¿En qué te ayudo?',
        '¡Hey! Bienvenido. ¿Quieres agendar, ver servicios o necesitas una recomendación?',
      ]), ['Quiero agendar', 'Ver precios', 'Recomiéndame algo']);
      return;
    }

    if (this.matchIntent(text, ['adios', 'bye', 'chao', 'chau', 'hasta luego', 'nos vemos', 'hasta pronto', 'hasta la vista', 'me voy'])) {
      this.pushBot(pick([
        '¡Hasta luego! Cualquier cosa, aquí ando 💈',
        '¡Nos vemos! Gracias por la charla. Que te quede increíble ese corte. ✂️',
        '¡Chao! Te espero cuando quieras reservar. 🤖',
      ]), ['Agendar antes de irme', 'Ver servicios']);
      return;
    }

    if (this.matchIntent(text, ['agendar', 'reservar', 'apartar', 'sacar cita', 'pedir cita', 'me apunto', 'anotar', 'agenda cita'])) {
      this.pushBot(
        '¡Excelente! Para agendar necesito saber qué servicio te interesa. ' +
        'Tenemos corte clásico, degradado, barba, corte+barba, tinte y diseños.\n\n' +
        'O dime qué tienes en mente y te ayudo a elegir.',
        catalog.map((s) => `${s.icon} ${s.name}`),
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
      this.pushBot(
        'Para cancelar o modificar una cita, ve a **Citas** en el menú, busca la tuya y usa el botón "Cancelar".\n\n' +
        '¿Quieres que te lleve?',
        ['Ir a Citas', 'Otra cosa'],
      );
      return;
    }

    if (this.matchIntent(text, ['cambiar', 'modificar', 'reagendar', 'mover', 'editar cita'])) {
      this.pushBot(
        'Para cambiar fecha u hora, ve a **Citas** y usa el botón "Editar" en la card correspondiente.',
        ['Ir a Citas', 'Otra cosa'],
      );
      return;
    }

    if (this.matchIntent(text, ['mis citas', 'citas agendadas', 'lo que tengo', 'que tengo', 'mis reservas'])) {
      this.pushBot(
        'En la página **Citas** puedes ver, filtrar y editar todas tus reservas. ¿Te llevo?',
        ['Ir a Citas', 'Crear una nueva'],
      );
      return;
    }

    if (this.matchIntent(text, ['pago', 'pagos', 'pagar', 'cobro', 'efectivo', 'tarjeta', 'transferencia', 'metodo de pago', 'como pago', 'aceptan'])) {
      this.pushBot(
        '💳 **Formas de pago**\n\n' +
        'Aceptamos efectivo, tarjeta de débito/crédito y transferencia.\n\n' +
        'El pago se realiza al finalizar el servicio en la barbería.',
        ['Ir a agendar', 'Ver precios'],
      );
      return;
    }

    if (this.matchIntent(text, ['ubicacion', 'direccion', 'donde', 'donde estan', 'como llegar', 'llegar', 'mapa'])) {
      this.pushBot(
        '📍 Estamos en el centro de la ciudad. La dirección exacta te la mandamos por WhatsApp al confirmar tu cita.\n\n' +
        '¿Quieres agendar y te la enviamos?',
        ['Sí, agendar', 'Otra cosa'],
      );
      return;
    }

    if (this.matchIntent(text, ['contacto', 'telefono', 'whatsapp', 'email', 'correo', 'humano', 'persona real'])) {
      this.pushBot(
        '📞 **Contacto**\n\n' +
        'WhatsApp: +52 555 010 1010\n' +
        'Email: hola@barberschedule.app',
        ['Seguir aquí', 'Ver servicios'],
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
      );
      return;
    }

    if (this.matchIntent(text, ['urgente', 'urgencia', 'rapido', 'lo antes posible', 'hoy mismo', 'para ya', 'apurale'])) {
      this.pushBot(
        '⚡ Para algo rápido, el **Corte clásico** (30 min, $120) o solo **Barba** (30 min, $100) son los más ágiles. ' +
        '¿Cuál prefieres?',
        ['Corte clásico', 'Solo barba', 'Combo completo'],
      );
      return;
    }

    if (this.matchIntent(text, ['gracias', 'grax', 'graxx', 'thanks', 'thx', 'ty', 'merci', 'mil gracias'])) {
      this.pushBot(pick([
        '¡De nada! Aquí ando cuando necesites. 💈',
        '¡Un placer! Cualquier otra duda, pregunta sin pena.',
        '¡Para eso estamos!',
      ]), ['Agendar ahora', 'Ver servicios']);
      return;
    }

    if (this.matchIntent(text, ['tonto', 'malo', 'no sirves', 'inutil', 'estupido', 'pendejo', 'cabron', 'idiota', 'menso'])) {
      this.pushBot(
        '😬 Soy un bot con reglas, no me ofendo pero no me ayudas. ' +
        '¿Quieres que te ayude a agendar o ver precios?',
        ['Ver precios', 'Agendar cita'],
      );
      return;
    }

    if (this.matchIntent(text, ['quien eres', 'que eres', 'eres real', 'eres humano', 'eres bot', 'eres ia', 'como te llamas', 'tu nombre'])) {
      this.pushBot(
        '🤖 Soy **BarberBot**, un asistente virtual con reglas. No soy IA real, ' +
        'estoy entrenado para ayudarte con la barbería. ¿En qué te ayudo?',
        ['Agendar cita', 'Ver servicios'],
      );
      return;
    }

    if (this.matchIntent(text, ['ya agende', 'ya tengo cita', 'ya reserve', 'ya quedo', 'ya agendo'])) {
      this.pushBot(
        '¡Genial! Si quieres ver, editar o cancelar, ve a **Citas**. ¿Te llevo?',
        ['Ir a Citas', 'Otra cosa'],
      );
      return;
    }

    if (this.matchIntent(text, ['http', 'www', 'instagram', 'facebook', 'tiktok', 'twitter', 'redes'])) {
      this.pushBot(
        '📱 Síguenos como **@BarberSchedule**. ¿Necesitas algo más?',
        ['Ver servicios', 'Agendar'],
      );
      return;
    }

    if (input.includes('?') || input.includes('¿')) {
      this.pushBot(
        'Buena pregunta, pero ese tema se me escapa. Te puedo ayudar con: agendar, precios, servicios, horarios, equipo o recomendaciones.\n\n' +
        '¿Cuál te interesa?',
        ['Precios', 'Horarios', 'Agendar', 'Recomendación'],
      );
      return;
    }

    // Fallback final
    this.pushBot(
      '🤔 No te cacho. Puedo ayudarte con:\n\n' +
      '• Agendar una cita\n' +
      '• Ver precios y servicios\n' +
      '• Conocer al equipo\n' +
      '• Recomendarte un look\n' +
      '• Decirte cómo funciona la app\n\n' +
      '¿Por dónde le entramos?',
      ['Agendar cita', 'Ver precios', 'Conocer al equipo', 'Recomiéndame algo'],
    );
  }

  // ───── HANDLERS ESPECÍFICOS ─────
  private goToForm(): void {
    if (this.state.lastServiceId || this.state.lastBarberId) {
      this.pushBot(
        `¡Va! Te llevo al formulario con todo pre-seleccionado. ✨`,
        ['Otra recomendación', 'Ver servicios'],
        this.state.lastServiceId,
        this.state.lastBarberId,
      );
    } else {
      this.pushBot(
        '¡Va! Elige primero un servicio para que te lo deje listo. ' +
        'Estos son los disponibles:',
        this.catalog.services().map((s) => `${s.icon} ${s.name}`),
      );
    }
  }

  private handleQuieroServicio(input: string): void {
    const catalog = this.catalog.services();
    // Extrae el servicio del texto "quiero X" o "agendar X"
    const m = input.match(/^(?:quiero|agendar)\s+(.+)$/i);
    if (!m) return;
    const query = norm(m[1]);
    // Buscar por match exacto de nombre o por alias
    const svc = detectService(query, catalog);
    if (svc) {
      this.state.lastServiceId = svc.id;
      this.state.lastServiceName = svc.name;
      this.pushBot(
        `¡Buena elección! ${svc.icon} **${svc.name}** dura ${svc.duration} min y cuesta $${svc.price}. ¿Lo agendamos?`,
        ['Sí, agendar', 'Ver otros servicios', 'Recomiéndame otro'],
        svc.id,
      );
    } else {
      this.pushBot(
        `No identifiqué "${m[1]}" como un servicio. Estos son los que tenemos:`,
        catalog.map((s) => `${s.icon} ${s.name}`),
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
      );
    } else {
      this.handleListBarbers();
    }
  }

  private handleNavigation(): void {
    this.pushBot(
      '📍 Puedo llevarte a:\n\n' +
      '• **Citas** — ver/editar/cancelar\n' +
      '• **Servicios** — ver catálogo\n' +
      '• **Barberos** — conocer al equipo\n' +
      '• **Inicio** — dashboard\n\n' +
      '¿A cuál vamos?',
      ['Ir a Citas', 'Ver servicios', 'Ver barberos', 'Ir a inicio'],
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
    );
  }

  private handleHoy(): void {
    this.pushBot(
      '¿Para hoy? Lo más rápido es ir al formulario y elegir horario. ' +
      'Los huecos ocupados se tachan automáticamente.',
      ['Ir al formulario', 'Mejor mañana', 'Ver disponibilidad general'],
    );
  }

  private handleManana(): void {
    this.pushBot(
      'Mañana es buena opción. Te llevo al formulario donde puedes elegir el día y la hora exactos.',
      ['Ir al formulario', 'Ver horarios primero', 'Mejor otro día'],
    );
  }

  private handleSabado(): void {
    this.pushBot(
      '🗓️ Trabajamos el **sábado de 10:00 a 18:00**. Los domingos descansamos. ' +
      '¿Te llevo al formulario?',
      ['Ir al formulario', 'Ver servicios', 'Mejor lunes'],
    );
  }

  private handleOtroDia(): void {
    this.pushBot(
      'La próxima semana tenemos huecos de lunes a sábado. ' +
      'Ve al formulario y elige el día que prefieras.',
      ['Ir al formulario', 'Ver servicios', 'Mejor otro día'],
    );
  }

  private handleDisponibilidad(): void {
    this.pushBot(
      '📊 La disponibilidad se muestra en tiempo real en el formulario de agendar — ' +
      'los slots ya ocupados aparecen tachados.\n\n' +
      '¿Vamos al formulario?',
      ['Ir al formulario', 'Ver servicios', 'Otra cosa'],
    );
  }

  private handleListServices(): void {
    const catalog = this.catalog.services();
    this.pushBot(
      '💈 **Nuestros servicios**\n\n' +
      catalog.map((s) => `${s.icon} ${s.name} — $${s.price} · ${svcDur(s.duration)}`).join('\n') +
      '\n\n¿Cuál te interesa?',
      catalog.map((s) => `Quiero ${s.name}`),
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
    );
  }

  private handleAffirmative(): void {
    if (this.state.lastServiceId) {
      this.pushBot(
        `¡Perfecto! Te llevo al formulario con **${this.state.lastServiceName}** pre-seleccionado. ✨`,
        ['Otra recomendación', 'Ver servicios'],
        this.state.lastServiceId,
        this.state.lastBarberId,
      );
    } else if (this.state.lastBarberId) {
      this.pushBot(
        `Va. Te llevo al formulario con **${this.state.lastBarberName}** pre-seleccionado.`,
        ['Otra recomendación', 'Ver servicios'],
        undefined,
        this.state.lastBarberId,
      );
    } else {
      this.pushBot('¿Qué quieres hacer?', ['Agendar cita', 'Ver precios', 'Recomiéndame algo']);
    }
  }

  private handleNegative(): void {
    this.pushBot(
      'No hay drama. ¿Qué te gustaría ver en su lugar?',
      ['Ver todos los servicios', 'Ver otros barberos', 'Recomiéndame algo'],
    );
  }

  private handleOtraPregunta(): void {
    this.pushBot(
      '¿En qué más te ayudo?',
      ['Agendar cita', 'Ver precios', 'Horarios', 'Recomiéndame algo'],
    );
  }

  private handleVolverInicio(): void {
    this.handleOtraPregunta();
  }

  // ───── HELPERS ─────
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
        timestamp: new Date(),
      },
    ]);
  }
}
