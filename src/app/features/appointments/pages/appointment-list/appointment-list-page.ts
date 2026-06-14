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
import { AppointmentCard } from '../../components/appointment-card/appointment-card';
import { ConfirmModal } from '../../../../shared/components/confirm-modal/confirm-modal';

type Filter = 'todas' | AppointmentStatus;

@Component({
  selector: 'app-appointment-list-page',
  imports: [RouterLink, AppointmentCard, ConfirmModal],
  templateUrl: './appointment-list-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppointmentListPage {
  private apptService = inject(AppointmentService);
  private router      = inject(Router);

  // --- Estado local con signals ---
  protected readonly filter = signal<Filter>('todas');
  protected readonly search = signal<string>('');
  protected readonly debouncedSearch = signal<string>('');
  protected readonly showDeleteModal  = signal<boolean>(false);
  protected readonly pendingDeleteId  = signal<number | null>(null);

  // Debounce manual (sin rxjs para mantener el ejemplo limpio)
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  // --- Selectores derivados ---
  protected readonly appointments = this.apptService.appointments;
  protected readonly loading      = this.apptService.loading;
  protected readonly counts       = this.apptService.countsByStatus;

  protected readonly filters: { key: Filter; label: string; count: () => number }[] = [
    { key: 'todas',      label: 'Todas',      count: () => this.appointments().length },
    { key: 'pendiente',  label: 'Pendientes', count: () => this.counts().pendiente },
    { key: 'confirmada', label: 'Confirmadas',count: () => this.counts().confirmada },
    { key: 'atendida',   label: 'Atendidas',  count: () => this.counts().atendida },
    { key: 'cancelada',  label: 'Canceladas', count: () => this.counts().cancelada },
  ];

  protected readonly visible = computed(() => {
    const f = this.filter();
    const q = this.debouncedSearch().toLowerCase().trim();
    return this.appointments()
      .filter((a) => f === 'todas' || a.status === f)
      .filter((a) => {
        if (!q) return true;
        return (
          a.clientName.toLowerCase().includes(q) ||
          a.phone.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  });

  // --- Handlers ---
  protected onSearchInput(value: string): void {
    this.search.set(value);
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => {
      this.debouncedSearch.set(value);
    }, 250);
  }

  protected setFilter(f: Filter): void {
    this.filter.set(f);
  }

  // --- Acciones del AppointmentCard ---
  protected onEdit(appt: Appointment): void {
    this.router.navigate(['/citas/editar', appt.id]);
  }

  protected onDelete(id: number): void {
    this.pendingDeleteId.set(id);
    this.showDeleteModal.set(true);
  }

  protected async onConfirmDelete(): Promise<void> {
    const id = this.pendingDeleteId();
    if (id == null) return;
    await this.apptService.remove(id);
    this.showDeleteModal.set(false);
    this.pendingDeleteId.set(null);
  }

  protected onCancelDelete(): void {
    this.showDeleteModal.set(false);
    this.pendingDeleteId.set(null);
  }

  protected async onConfirm(id: number): Promise<void> {
    await this.apptService.changeStatus(id, 'confirmada');
  }
  protected async onAttend(id: number): Promise<void> {
    await this.apptService.changeStatus(id, 'atendida');
  }
  protected async onCancel(id: number): Promise<void> {
    await this.apptService.changeStatus(id, 'cancelada');
  }

  protected statusLabel(s: Filter): string {
    return s === 'todas' ? 'Todas' : STATUS_LABELS[s as AppointmentStatus];
  }

  // Para el template
  protected readonly ALL_STATUSES = APPOINTMENT_STATUSES;
}
