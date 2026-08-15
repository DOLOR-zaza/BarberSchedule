import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AppointmentStatus,
  APPOINTMENT_STATUSES,
  STATUS_LABELS,
} from '../../../../core/models';
import { AppointmentService } from '../../../../core/services';
import { AppointmentCard } from '../../components/appointment-card/appointment-card';

type Filter = 'todas' | AppointmentStatus;

@Component({
  selector: 'app-appointment-list-page',
  imports: [RouterLink, AppointmentCard],
  templateUrl: './appointment-list-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppointmentListPage {
  private apptService = inject(AppointmentService);

  protected readonly filter = signal<Filter>('todas');
  protected readonly search = signal<string>('');
  protected readonly debouncedSearch = signal<string>('');

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  protected readonly appointments = this.apptService.appointments;
  protected readonly loading = this.apptService.loading;
  protected readonly error = this.apptService.error;
  protected readonly counts = this.apptService.countsByStatus;

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
          a.email.toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        (b.date + b.time).localeCompare(a.date + a.time),
      );
  });

  protected readonly ALL_STATUSES = APPOINTMENT_STATUSES;

  constructor() {
    void this.apptService.loadAll();
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

  protected statusLabel(s: Filter): string {
    return s === 'todas'
      ? 'Todas'
      : STATUS_LABELS[s as AppointmentStatus];
  }

  protected reload(): void {
    void this.apptService.loadAll();
  }
}
