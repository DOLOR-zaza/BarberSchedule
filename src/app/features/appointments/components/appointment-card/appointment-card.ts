import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  Appointment,
  AppointmentStatus,
} from '../../../../core/models';
import {
  BarberService,
  ServiceCatalogService,
} from '../../../../core/services';
import { StatusBadge } from '../../../../shared/components/status-badge/status-badge';
import { TiltOnHoverDirective } from '../../../../shared/directives/tilt-on-hover.directive';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-appointment-card',
  imports: [StatusBadge, TiltOnHoverDirective],
  templateUrl: './appointment-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppointmentCard {
  readonly appointment = input.required<Appointment>();
  readonly compact = input<boolean>(false);

  readonly mode = input<'client' | 'admin'>('admin');

  /**
   * En DEV se conserva el borrado permanente existente.
   * En PROD V25 se oculta: las citas se cancelan y se conserva historial.
   */
  readonly showDelete = input<boolean>(true);

  readonly edit = output<Appointment>();
  readonly delete = output<number>();
  readonly confirm = output<number>();
  readonly attend = output<number>();
  readonly cancel = output<number>();

  private catalog = inject(ServiceCatalogService);
  private barbers = inject(BarberService);

  protected readonly service = computed(() =>
    this.catalog.getById(
      this.appointment().serviceId,
    ),
  );

  protected readonly barber = computed(() =>
    this.barbers.getById(
      this.appointment().barberId,
    ),
  );

  protected readonly actions = computed<readonly ActionDef[]>(() => {
    const status: AppointmentStatus =
      this.appointment().status;

    if (this.mode() === 'client') {
      return [];
    }

    const allowDelete =
      this.showDelete() &&
      !environment.useSupabase;

    const deleteButton: ActionDef = {
      key: 'delete',
      label: 'Eliminar',
      icon: '🗑',
      variant: 'ghost',
    };

    const map: Record<
      AppointmentStatus,
      ActionDef[]
    > = {
      pendiente: [
        {
          key: 'confirm',
          label: 'Confirmar',
          icon: '✓',
          variant: 'primary',
        },
        {
          key: 'edit',
          label: 'Editar',
          icon: '✎',
          variant: 'ghost',
        },
        {
          key: 'cancel',
          label: 'Cancelar',
          icon: '✕',
          variant: 'danger',
        },
        ...(allowDelete ? [deleteButton] : []),
      ],
      confirmada: [
        {
          key: 'attend',
          label: 'Marcar atendida',
          icon: '✦',
          variant: 'primary',
        },
        {
          key: 'edit',
          label: 'Editar',
          icon: '✎',
          variant: 'ghost',
        },
        {
          key: 'cancel',
          label: 'Cancelar',
          icon: '✕',
          variant: 'danger',
        },
        ...(allowDelete ? [deleteButton] : []),
      ],
      atendida: allowDelete
        ? [deleteButton]
        : [],
      cancelada: allowDelete
        ? [deleteButton]
        : [],
    };

    return map[status] ?? [];
  });

  protected onAction(
    key: ActionDef['key'],
  ): void {
    const id = this.appointment().id;
    const appointment = this.appointment();

    switch (key) {
      case 'edit':
        this.edit.emit(appointment);
        break;
      case 'delete':
        this.delete.emit(id);
        break;
      case 'confirm':
        this.confirm.emit(id);
        break;
      case 'attend':
        this.attend.emit(id);
        break;
      case 'cancel':
        this.cancel.emit(id);
        break;
    }
  }

  protected actionClass(
    variant: ActionDef['variant'],
  ): string {
    switch (variant) {
      case 'primary':
        return 'bg-brand-500 hover:bg-brand-400 text-ink-950 shadow-sm shadow-brand-500/30';
      case 'danger':
        return 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 ring-1 ring-rose-500/30';
      case 'ghost':
      default:
        return 'bg-white/5 hover:bg-white/10 text-ink-200 ring-1 ring-white/10';
    }
  }
}

type ActionDef = {
  key:
    | 'edit'
    | 'delete'
    | 'confirm'
    | 'attend'
    | 'cancel';
  label: string;
  icon: string;
  variant: 'primary' | 'danger' | 'ghost';
};
