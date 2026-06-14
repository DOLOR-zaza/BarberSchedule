import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  APPOINTMENT_STATUSES,
  AppointmentStatus,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../../../core/models';

/**
 * Etiqueta visual para el estado de una cita.
 *
 * Uso:
 *   <app-status-badge [status]="'confirmada'" />
 *   <app-status-badge [status]="appt.status" [size]="'lg'" [showIcon]="false" />
 */
@Component({
  selector: 'app-status-badge',
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full font-medium ring-1"
      [class]="sizeClasses()"
      [class]="colorClasses().bg"
      [class]="colorClasses().text"
      [class]="colorClasses().ring"
    >
      @if (showIcon()) {
        <span class="text-base leading-none">{{ icon() }}</span>
      }
      <span>{{ label() }}</span>
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadge {
  /** Estado de la cita. Requerido. */
  readonly status = input.required<AppointmentStatus>();

  /** Tamaño del badge. Default: 'md' */
  readonly size = input<'sm' | 'md' | 'lg'>('md');

  /** Mostrar ícono al lado del texto. Default: true */
  readonly showIcon = input<boolean>(true);

  protected readonly label = computed(() => STATUS_LABELS[this.status()]);

  protected readonly colorClasses = computed(() => STATUS_COLORS[this.status()]);

  protected readonly sizeClasses = computed(() => {
    switch (this.size()) {
      case 'sm': return 'px-2 py-0.5 text-[10px]';
      case 'lg': return 'px-4 py-1.5 text-sm';
      default:   return 'px-3 py-1 text-xs';
    }
  });

  protected readonly icon = computed(() => {
    const map: Record<AppointmentStatus, string> = {
      pendiente:  '⏳',
      confirmada: '✓',
      atendida:   '✦',
      cancelada:  '✕',
    };
    return map[this.status()];
  });

  /** Helper para consumidores que quieran iterar. */
  static readonly allStatuses = APPOINTMENT_STATUSES;
}
