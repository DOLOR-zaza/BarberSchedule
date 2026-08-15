import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Appointment, AppointmentStatus } from '../../../../core/models';
import {
  AppointmentService,
  BarberService,
  ServiceCatalogService,
} from '../../../../core/services';
import { environment } from '../../../../../environments/environment';

type Step = 1 | 2 | 3;

@Component({
  selector: 'app-appointment-form-page',
  imports: [ReactiveFormsModule, RouterLink, NgClass],
  templateUrl: './appointment-form-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppointmentFormPage {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private appts = inject(AppointmentService);
  private barbers = inject(BarberService);
  private catalog = inject(ServiceCatalogService);

  // Inputs vía withComponentInputBinding
  /** ID de cita a editar (route param :id). Si está, modo edición. */
  readonly id = input<string | undefined>();

  /** serviceId pre-seleccionado desde query param (BarberBot). */
  readonly serviceParam = input<string | undefined>();

  /** barberId pre-seleccionado desde query param (página de barberos). */
  readonly barberParam = input<string | undefined>();

  // Estado de UI
  protected readonly currentStep = signal<Step>(1);
  protected readonly submitting = signal<boolean>(false);
  protected readonly errorMsg = signal<string | null>(null);
  protected readonly loadingAppointment = signal<boolean>(false);
  protected readonly isEdit = computed(() => !!this.id());

  /**
   * Cita original que estamos editando.
   * Se usa también para no marcar como "ocupado" su propio horario.
   */
  private readonly editingAppointment = signal<Appointment | null>(null);
  private loadedEditId: number | null = null;

  // Formulario reactivo
  protected readonly form = this.fb.nonNullable.group({
    serviceId: [null as number | null, Validators.required],
    barberId: [null as number | null, Validators.required],
    date: ['', Validators.required],
    time: ['', Validators.required],
    clientName: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, Validators.pattern(/^[\d\s\-()+]+$/)]],
    email: ['', [Validators.required, Validators.email]],
    notes: [''],
  });

  protected readonly services = this.catalog.services;
  protected readonly barbersSv = this.barbers.barbers;

  // Slots 10:00–19:30 cada 30 min
  protected readonly timeSlots = generateTimeSlots(10, 20, 30);

  private readonly formValue = toSignal(
    this.form.valueChanges,
    { initialValue: this.form.getRawValue() },
  );

  private readonly barberIdSignal = toSignal(
    this.form.controls.barberId.valueChanges,
    { initialValue: this.form.controls.barberId.value },
  );

  private readonly dateSignal = toSignal(
    this.form.controls.date.valueChanges,
    { initialValue: this.form.controls.date.value },
  );

  /**
   * En edición, el RPC de disponibilidad también devuelve el horario
   * de la cita actual. Lo retiramos únicamente si seguimos en el mismo
   * barbero + fecha originales, para permitir guardar sin mover la cita.
   */
  protected readonly occupiedSlots = computed(() => {
    const barberId = this.barberIdSignal();
    const date = this.dateSignal();

    if (!barberId || !date) {
      return [] as string[];
    }

    const slots = this.appts.occupiedSlots(barberId, date);
    const current = this.editingAppointment();

    if (
      current &&
      current.barberId === barberId &&
      current.date === date
    ) {
      return slots.filter((slot) => slot !== current.time);
    }

    return slots;
  });

  protected readonly availabilityLoading = this.appts.availabilityLoading;
  protected readonly availabilityError = this.appts.availabilityError;

  protected readonly canAdvance = computed<boolean>(() => {
    const v = this.formValue();

    switch (this.currentStep()) {
      case 1:
        return v.serviceId != null && v.serviceId !== undefined;
      case 2:
        return (
          v.barberId != null &&
          !!v.date &&
          !!v.time &&
          !this.appts.availabilityError() &&
          !this.appts.availabilityLoading()
        );
      case 3:
        return this.form.valid;
      default:
        return false;
    }
  });

  protected readonly stepLabels = [
    'Servicio',
    'Barbero y horario',
    'Datos del cliente',
  ];

  constructor() {
    // 1. Query param service
    effect(() => {
      const sp = this.serviceParam();
      if (sp) {
        const id = Number(sp);
        if (!Number.isNaN(id)) {
          this.form.controls.serviceId.setValue(id);
        }
      }
    });

    // 2. Query param barber
    effect(() => {
      const bp = this.barberParam();
      if (bp) {
        const id = Number(bp);
        if (!Number.isNaN(id)) {
          this.form.controls.barberId.setValue(id);
        }
      }
    });

    // 3. Preselección salta al paso 2
    effect(() => {
      const hasPre = this.serviceParam() || this.barberParam();
      if (hasPre && this.currentStep() === 1) {
        this.currentStep.set(2);
      }
    });

    // 4. Modo edición: carga por ID incluso si se entra por URL directa.
    effect(() => {
      const idStr = this.id();

      if (!idStr) {
        return;
      }

      const id = Number(idStr);
      if (Number.isNaN(id) || id === this.loadedEditId) {
        return;
      }

      this.loadedEditId = id;
      void this.loadAppointmentForEdit(id);
    });

    // 5. Disponibilidad
    effect(() => {
      const b = this.barberIdSignal();
      const d = this.dateSignal();

      if (b && d) {
        void this.appts.loadOccupiedSlots(b, d);
      } else {
        this.appts.resetOccupiedSlots();
      }
    });
  }

  private async loadAppointmentForEdit(id: number): Promise<void> {
    this.loadingAppointment.set(true);
    this.errorMsg.set(null);

    const appointment = await this.appts.getById(id);

    if (!appointment) {
      this.errorMsg.set(
        this.appts.error() ??
          'No se pudo cargar la cita para editar.',
      );
      this.loadingAppointment.set(false);
      return;
    }

    this.editingAppointment.set(appointment);
    this.hydrate(appointment);

    // En edición mostramos directamente el formulario desde el primer paso.
    this.currentStep.set(1);
    this.loadingAppointment.set(false);
  }

  private hydrate(a: Appointment): void {
    this.form.patchValue({
      serviceId: a.serviceId,
      barberId: a.barberId,
      date: a.date,
      time: a.time,
      clientName: a.clientName,
      phone: a.phone,
      email: a.email,
      notes: a.notes,
    });
  }

  protected next(): void {
    this.errorMsg.set(null);
    const s = this.currentStep();

    if (!this.canAdvance()) {
      this.form.markAllAsTouched();
      return;
    }

    if (s < 3) {
      this.currentStep.set((s + 1) as Step);
    }
  }

  protected back(): void {
    const s = this.currentStep();
    if (s > 1) {
      this.currentStep.set((s - 1) as Step);
    }
  }

  protected goTo(step: Step): void {
    if (step <= this.currentStep()) {
      this.currentStep.set(step);
    }
  }

  protected selectService(id: number): void {
    this.form.controls.serviceId.setValue(id);
    this.form.controls.serviceId.markAsTouched();
  }

  protected selectBarber(id: number): void {
    const previousBarber = this.form.controls.barberId.value;

    this.form.controls.barberId.setValue(id);
    this.form.controls.barberId.markAsTouched();

    // Si realmente cambió el barbero, el horario debe reelegirse.
    if (previousBarber !== id) {
      this.form.controls.time.setValue('');
      this.form.controls.time.markAsUntouched();
    }
  }

  protected onDateChange(): void {
    const original = this.editingAppointment();
    const currentDate = this.form.controls.date.value;

    // Si el admin vuelve a seleccionar la fecha original, mantenemos
    // el horario original; para una fecha distinta, debe elegir otro.
    if (original && currentDate === original.date) {
      this.form.controls.time.setValue(original.time);
    } else {
      this.form.controls.time.setValue('');
      this.form.controls.time.markAsUntouched();
    }
  }

  protected selectTime(slot: string): void {
    this.form.controls.time.setValue(slot);
    this.form.controls.time.markAsTouched();
  }

  protected isServiceSelected(id: number): boolean {
    return this.form.controls.serviceId.value === id;
  }

  protected isBarberSelected(id: number): boolean {
    return this.form.controls.barberId.value === id;
  }

  protected isTimeSelected(slot: string): boolean {
    return this.form.controls.time.value === slot;
  }

  protected isTimeOccupied(slot: string): boolean {
    return this.occupiedSlots().includes(slot);
  }

  protected async onSubmit(): Promise<void> {
    this.errorMsg.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    const v = this.form.getRawValue();

    try {
      if (this.isEdit()) {
        const id = Number(this.id());

        const patch = Object.fromEntries(
          Object.entries(v).filter(([, val]) => val !== null),
        );

        const updated = await this.appts.update(id, patch);

        if (!updated) {
          throw new Error(
            this.appts.error() ?? 'No se pudo actualizar',
          );
        }

        await this.router.navigate(['/citas']);
        return;
      }

      const ok = await this.appts.create({
        ...v,
        serviceId: v.serviceId!,
        barberId: v.barberId!,
        status: 'pendiente' as AppointmentStatus,
      });

      if (!ok) {
        throw new Error(
          this.appts.error() ?? 'No se pudo crear',
        );
      }

      if (environment.useSupabase) {
        await this.router.navigate(['/inicio'], {
          queryParams: { booked: 'true' },
        });
      } else {
        await this.router.navigate(['/citas']);
      }
    } catch (e) {
      this.errorMsg.set(
        e instanceof Error ? e.message : 'Error inesperado',
      );
    } finally {
      this.submitting.set(false);
    }
  }

  protected getDateMin(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

function generateTimeSlots(
  startHour: number,
  endHour: number,
  stepMin: number,
): string[] {
  const slots: string[] = [];

  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      slots.push(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      );
    }
  }

  return slots;
}
