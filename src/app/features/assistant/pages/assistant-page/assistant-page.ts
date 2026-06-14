import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { ChatbotService } from '../../../../core/services';

/**
 * Página del asistente BarberBot. Chat completo con:
 *  - Burbujas con animación de entrada
 *  - Typing indicator mientras el bot "piensa"
 *  - Quick reply chips que ejecutan acciones (texto o navegación)
 *  - Sugerencia de servicio: navega a /nueva-cita?service=N
 *  - Auto-scroll al último mensaje
 *  - Botón de reset
 */
@Component({
  selector: 'app-assistant-page',
  imports: [FormsModule, NgClass],
  templateUrl: './assistant-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantPage implements AfterViewInit {
  private bot     = inject(ChatbotService);
  private router  = inject(Router);

  // Referencias a los elementos del DOM para scroll
  private messagesEnd = viewChild<ElementRef<HTMLDivElement>>('messagesEnd');
  private inputEl     = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  // Estado local
  protected readonly draft = signal<string>('');

  // Selectores del service
  protected readonly messages = this.bot.messages;
  protected readonly isTyping = this.bot.isTyping;

  constructor() {
    // Auto-scroll cuando llegan mensajes o termina de "escribir" el bot
    effect(() => {
      this.messages();      // depende de messages
      this.isTyping();      // y de isTyping
      queueMicrotask(() => this.scrollToBottom());
    });
  }

  ngAfterViewInit(): void {
    // Saludo inicial solo si la conversación está vacía
    if (this.messages().length === 0) {
      this.bot.initConversation();
    }
    // Focus en el input al cargar
    setTimeout(() => this.inputEl()?.nativeElement.focus(), 300);
  }

  // --- Acciones de UI ---
  protected send(): void {
    const text = this.draft();
    if (!text.trim()) return;
    this.bot.processUserInput(text);
    this.draft.set('');
  }

  protected sendQuick(text: string): void {
    this.bot.processUserInput(text);
  }

  protected onEnter(e: Event): void {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' && !ke.shiftKey) {
      ke.preventDefault();
      this.send();
    }
  }

  protected reset(): void {
    this.bot.reset();
  }

  /**
   * Si el último mensaje del bot sugiere un servicio o barbero, este botón
   * navega al formulario con los query params que ya sabemos leer.
   */
  protected goToSuggestedForm(serviceId?: number, barberId?: number): void {
    const queryParams: Record<string, number> = {};
    if (serviceId) queryParams['service'] = serviceId;
    if (barberId)  queryParams['barber']  = barberId;
    this.router.navigate(['/nueva-cita'], { queryParams });
  }

  private scrollToBottom(): void {
    const el = this.messagesEnd()?.nativeElement;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }
}
