import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ChatbotService } from '../../../../core/services';

@Component({
  selector: 'app-assistant-page',
  imports: [FormsModule, NgClass, RouterLink],
  templateUrl: './assistant-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantPage implements AfterViewInit {
  protected bot     = inject(ChatbotService);
  private router  = inject(Router);

  private messagesEnd = viewChild<ElementRef<HTMLDivElement>>('messagesEnd');
  private inputEl     = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  protected readonly draft = signal<string>('');

  protected readonly messages = this.bot.messages;
  protected readonly isTyping = this.bot.isTyping;
  protected readonly mode     = this.bot.mode;

  /** True si el modo AI está seleccionado Y tiene webhook configurado */
  protected readonly hasAI = computed(() => !!this.bot.aiWebhookUrl());

  protected readonly inputPlaceholder = computed(() => {
    if (this.bot.mode() === 'ai') {
      return this.bot.aiWebhookUrl()
        ? 'Pregúntale algo a BarberBot AI…'
        : 'Configura el webhook AI en /gestion';
    }
    return 'Escribe un mensaje…';
  });

  constructor() {
    effect(() => {
      this.messages();
      this.isTyping();
      queueMicrotask(() => this.scrollToBottom());
    });
  }

  ngAfterViewInit(): void {
    if (this.messages().length === 0) {
      this.bot.initConversation();
    }
    setTimeout(() => this.inputEl()?.nativeElement.focus(), 300);
  }

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

  /** Cambia entre modo básico y AI */
  protected setMode(mode: 'rule-based' | 'ai'): void {
    this.bot.configure({ mode });
    // Si cambia a AI sin webhook configurado, igual lo permite pero avisa
  }

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
