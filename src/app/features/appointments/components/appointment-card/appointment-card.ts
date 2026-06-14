import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Appointment, AppointmentStatus } from '../../../../core/models';
import { BarberService, ServiceCatalogService } from '../../../../core/services';
import { StatusBadge } from '../../../../shared/components/status-badge/status-badge';
import { TiltOnHoverDirective } from '../../../../shared/directives/tilt-on-hover.directive';

/**
 * Tarjeta de cita con @Input() y @Output() para cumplir el
 * requisito de rúbrica: "componentes haciendo uso de I/O".
 *
 * El padre (lista) manda la cita y recibe los eventos.
 * El componente NO muta datos: solo emite intenciones.
 */
@Component({
  selector: 'app-appointment-card',
  imports: [StatusBadge, TiltOnHoverDirective],
  templateUrl: './appointment-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppointmentCard {
  // --- Inputs ---
  /** Cita a renderizar. Requerida. */
  readonly appointment = input.required<Appointment>();

  /** Modo compacto para listas densas. Default: false */
  readonly compact = input<boolean>(false);

  /** Mostrar el botón eliminar. Default: true */
  readonly showDelete = input<boolean>(true);

  // --- Outputs (eventos que el padre escucha) ---
  /** Emite la cita completa cuando el usuario pide editarla. */
  readonly edit    = output<Appointment>();
  /** Emite el id cuando se solicita eliminar. */
  readonly delete  = output<number>();
  /** Emite el id cuando se confirma una cita pendiente. */
  readonly confirm = output<number>();
  /** Emite el id cuando se marca como atendida. */
  readonly attend  = output<number>();
  /** Emite el id cuando se cancela una cita. */
  readonly cancel  = output<number>();

  // --- Inyecciones para enriquecer la vista ---
  private catalog = inject(ServiceCatalogService);
  private barbers = inject(BarberService);

  // --- Selectores derivados ---
  protected readonly service = computed(() =>
    this.catalog.getById(this.appointment().serviceId),
  );
  protected readonly barber = computed(() =>
    this.barbers.getById(this.appointment().barberId),
  );

  /**
   * Acciones disponibles según el estado actual.
   * Mantiene la UI declarativa: el padre solo escucha eventos.
   */
  protected readonly actions = computed<readonly ActionDef[]>(() => {
    const status: AppointmentStatus = this.appointment().status;
    const showDelete = this.showDelete();
    const delBtn: ActionDef = { key: 'delete', label: 'Eliminar', icon: '🗑', variant: 'ghost' };

    const map: Record<AppointmentStatus, ActionDef[]> = {
      pendiente: [
        { key: 'confirm', label: 'Confirmar',   icon: '✓', variant: 'primary' },
        { key: 'edit',    label: 'Editar',      icon: '✎', variant: 'ghost'   },
        { key: 'cancel',  label: 'Cancelar',    icon: '✕', variant: 'danger'  },
        ...(showDelete ? [delBtn] : []),
      ],
      confirmada: [
        { key: 'attend', label: 'Marcar atendida', icon: '✦', variant: 'primary' },
        { key: 'edit',   label: 'Editar',          icon: '✎', variant: 'ghost'   },
        { key: 'cancel', label: 'Cancelar',        icon: '✕', variant: 'danger'  },
        ...(showDelete ? [delBtn] : []),
      ],
      atendida:   showDelete ? [delBtn] : [],
      cancelada:  showDelete ? [delBtn] : [],
    };
    return map[status] ?? [];
  });

  /** Dispatcher: enruta el click al Output correspondiente. */
  protected onAction(key: ActionDef['key']): void {
    const id = this.appointment().id;
    const a  = this.appointment();
    switch (key) {
      case 'edit':    this.edit.emit(a);    break;
      case 'delete':  this.delete.emit(id); break;
      case 'confirm': this.confirm.emit(id); break;
      case 'attend':  this.attend.emit(id);  break;
      case 'cancel':  this.cancel.emit(id);  break;
    }
  }

  /** Clases de Tailwind según la variante de la acción. */
  protected actionClass(variant: ActionDef['variant']): string {
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
  key: 'edit' | 'delete' | 'confirm' | 'attend' | 'cancel';
  label: string;
  icon: string;
  variant: 'primary' | 'danger' | 'ghost';
};
