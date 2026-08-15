import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  Appointment,
  AppointmentStatus,
  APPOINTMENT_STATUSES,
  STATUS_LABELS,
} from '../../../../core/models';
import { AppointmentService } from '../../../../core/services';
import { ChatbotService } from '../../../../core/services/chatbot.service';
import { N8nService } from '../../../../core/services/n8n.service';
import { AppointmentCard } from '../../../appointments/components/appointment-card/appointment-card';
import { ConfirmModal } from '../../../../shared/components/confirm-modal/confirm-modal';

type Filter = 'todas' | AppointmentStatus;

@Component({
  selector: 'app-gestion-page',
  imports: [RouterLink, AppointmentCard, ConfirmModal],
  templateUrl: './gestion-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GestionPage {
  private apptService = inject(AppointmentService);
  private router = inject(Router);

  protected readonly n8n = inject(N8nService);
  protected readonly bot = inject(ChatbotService);

  protected readonly filter = signal<Filter>('todas');
  protected readonly search = signal<string>('');
  protected readonly debouncedSearch = signal<string>('');
  protected readonly showDeleteModal = signal<boolean>(false);
  protected readonly pendingDeleteId = signal<number | null>(null);

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  protected readonly appointments = this.apptService.appointments;
  protected readonly loading = this.apptService.loading;
  protected readonly error = this.apptService.error;
  protected readonly counts = this.apptService.countsByStatus;
  protected readonly todayCount = this.apptService.todayCount;
  protected readonly totalCount = this.apptService.count;

  protected readonly filters: {
    key: Filter;
    label: string;
    count: () => number;
  }[] = [
    {
      key: 'todas',
      label: 'Todas',
      count: () => this.appointments().length,
    },
    {
      key: 'pendiente',
      label: 'Pendientes',
      count: () => this.counts().pendiente,
    },
    {
      key: 'confirmada',
      label: 'Confirmadas',
      count: () => this.counts().confirmada,
    },
    {
      key: 'atendida',
      label: 'Atendidas',
      count: () => this.counts().atendida,
    },
    {
      key: 'cancelada',
      label: 'Canceladas',
      count: () => this.counts().cancelada,
    },
  ];

  protected readonly visible = computed(() => {
    const f = this.filter();
    const q = this.debouncedSearch()
      .toLowerCase()
      .trim();

    return this.appointments()
      .filter((a) => f === 'todas' || a.status === f)
      .filter((a) => {
        if (!q) {
          return true;
        }

        return (
          a.clientName.toLowerCase().includes(q) ||
          a.phone.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q) ||
          a.notes.toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        (b.date + b.time).localeCompare(a.date + a.time),
      );
  });

  protected readonly ALL_STATUSES = APPOINTMENT_STATUSES;

  constructor() {
    this.n8n.restore();

    // V25.2:
    // la ruta está detrás de adminGuard; al entrar cargamos
    // las citas desde json-server (DEV) o Supabase (PROD).
    void this.apptService.loadAll();
  }

  protected onN8nModeChange(
    mode: 'disabled' | 'demo' | 'live',
  ): void {
    this.n8n.configure({
      mode,
      webhookUrl: this.n8n.webhookUrl(),
    });
  }

  protected onN8nUrlChange(url: string): void {
    this.n8n.configure({
      mode: this.n8n.mode(),
      webhookUrl: url,
    });
  }

  protected onChatModeChange(
    mode: 'rule-based' | 'ai',
  ): void {
    this.bot.configure({ mode });
  }

  protected onAIWebhookChange(url: string): void {
    this.bot.configure({ webhookUrl: url });
  }

  protected onSearchInput(value: string): void {
    this.search.set(value);

    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
    }

    this.debounceHandle = setTimeout(() => {
      this.debouncedSearch.set(value);
    }, 250);
  }

  protected setFilter(f: Filter): void {
    this.filter.set(f);
  }

  protected onEdit(appt: Appointment): void {
    void this.router.navigate([
      '/citas/editar',
      appt.id,
    ]);
  }

  protected onDelete(id: number): void {
    this.pendingDeleteId.set(id);
    this.showDeleteModal.set(true);
  }

  protected async onConfirmDelete(): Promise<void> {
    const id = this.pendingDeleteId();

    if (id == null) {
      return;
    }

    await this.apptService.remove(id);

    this.showDeleteModal.set(false);
    this.pendingDeleteId.set(null);
  }

  protected onCancelDelete(): void {
    this.showDeleteModal.set(false);
    this.pendingDeleteId.set(null);
  }

  protected async onConfirm(id: number): Promise<void> {
    await this.apptService.changeStatus(
      id,
      'confirmada',
    );
  }

  protected async onAttend(id: number): Promise<void> {
    await this.apptService.changeStatus(
      id,
      'atendida',
    );
  }

  protected async onCancel(id: number): Promise<void> {
    await this.apptService.changeStatus(
      id,
      'cancelada',
    );
  }

  protected statusLabel(s: Filter): string {
    return s === 'todas'
      ? 'Todas'
      : STATUS_LABELS[s as AppointmentStatus];
  }

  protected reload(): void {
    void this.apptService.loadAll();
  }
}
