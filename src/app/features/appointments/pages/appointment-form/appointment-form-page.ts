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

type Step = 1 | 2 | 3;

@Component({
  selector: 'app-appointment-form-page',
  imports: [ReactiveFormsModule, RouterLink, NgClass],
  templateUrl: './appointment-form-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppointmentFormPage {
  private fb        = inject(FormBuilder);
  private router    = inject(Router);
  private appts     = inject(AppointmentService);
  private barbers   = inject(BarberService);
  private catalog   = inject(ServiceCatalogService);

  // --- Inputs vía withComponentInputBinding ---
  /** ID de cita a editar (route param :id). Si está, modo edición. */
  readonly id = input<string | undefined>();

  /** serviceId pre-seleccionado desde query param (BarberBot). */
  readonly serviceParam = input<string | undefined>();

  /** barberId pre-seleccionado desde query param (página de barberos). */
  readonly barberParam = input<string | undefined>();

  // --- Estado de UI ---
  protected readonly currentStep = signal<Step>(1);
  protected readonly submitting  = signal<boolean>(false);
  protected readonly errorMsg    = signal<string | null>(null);
  protected readonly isEdit      = computed(() => !!this.id());

  // --- Formulario reactivo ---
  protected readonly form = this.fb.nonNullable.group({
    serviceId:  [null as number | null, Validators.required],
    barberId:   [null as number | null, Validators.required],
    date:       ['',                     Validators.required],
    time:       ['',                     Validators.required],
    clientName: ['',                     [Validators.required, Validators.minLength(2)]],
    phone:      ['',                     [Validators.required, Validators.pattern(/^[\d\s\-()+]+$/)]],
    email:      ['',                     [Validators.required, Validators.email]],
    notes:      [''],
  });

  // Catálogos para render
  protected readonly services  = this.catalog.services;
  protected readonly barbersSv = this.barbers.barbers;

  // Slots 10:00–19:30 cada 30 min
  protected readonly timeSlots = generateTimeSlots(10, 20, 30);

  /**
   * Signal reactiva que refleja el valor actual del form.
   * Convierte form.valueChanges (Observable) en signal.
   * Se usa SOLO para `canAdvance` (que necesita varios campos).
   */
  private readonly formValue = toSignal(
    this.form.valueChanges,
    { initialValue: this.form.getRawValue() }
  );

  /**
   * Signals reactivas para barberId y date, derivadas
   * individualmente de los valueChanges. Permiten que el
   * `computed` de occupiedSlots y el effect #5 reaccionen
   * SOLO a cambios de estos dos campos (no a time, clientName,
   * phone, email, notes, que también disparan valueChanges).
   */
  private readonly barberIdSignal = toSignal(
    this.form.controls.barberId.valueChanges,
    { initialValue: this.form.controls.barberId.value },
  );
  private readonly dateSignal = toSignal(
    this.form.controls.date.valueChanges,
    { initialValue: this.form.controls.date.value },
  );

  // Slots ocupados para el barbero+fecha actual
  protected readonly occupiedSlots = computed(() => {
    const b = this.barberIdSignal();
    const d = this.dateSignal();
    if (!b || !d) return [] as string[];
    return this.appts.occupiedSlots(b, d);
  });

  // Re-exports de los signals de disponibilidad del servicio.
  // El template los consume directamente (no usa `appts.*` porque
  // `appts` es private). Almacenan la misma referencia al signal
  // del servicio, por lo que cualquier cambio se refleja en tiempo real.
  protected readonly availabilityLoading = this.appts.availabilityLoading;
  protected readonly availabilityError   = this.appts.availabilityError;

  // Validación por paso — usa formValue() (cubre varios campos)
  protected readonly canAdvance = computed<boolean>(() => {
    const v = this.formValue();
    switch (this.currentStep()) {
      case 1: return v.serviceId != null && v.serviceId !== undefined;
      case 2: return v.barberId != null
        && !!v.date
        && !!v.time
        && !this.appts.availabilityError()
        && !this.appts.availabilityLoading();
      case 3: return this.form.valid;
      default: return false;
    }
  });

  protected readonly stepLabels = ['Servicio', 'Barbero y horario', 'Datos del cliente'];

  constructor() {
    // --- Effects ---
    // 1. Si hay serviceParam, preselecciona servicio
    effect(() => {
      const sp = this.serviceParam();
      if (sp) {
        const id = Number(sp);
        if (!Number.isNaN(id)) {
          this.form.controls.serviceId.setValue(id);
        }
      }
    });

    // 2. Si hay barberParam, preselecciona barbero
    effect(() => {
      const bp = this.barberParam();
      if (bp) {
        const id = Number(bp);
        if (!Number.isNaN(id)) {
          this.form.controls.barberId.setValue(id);
        }
      }
    });

    // 3. Si hay serviceParam o barberParam y aún estamos en paso 1, salta al 2
    effect(() => {
      const hasPre = this.serviceParam() || this.barberParam();
      if (hasPre && this.currentStep() === 1) {
        this.currentStep.set(2);
      }
    });

    // 4. Si hay id, cargar la cita (modo edición)
    effect(() => {
      const idStr = this.id();
      if (!idStr) return;
      const id = Number(idStr);
      if (Number.isNaN(id)) return;
      const a = this.appts.appointments().find((x) => x.id === id);
      if (a) this.hydrate(a);
    });

    // 5. Cuando cambien barbero/fecha, consultar disponibilidad.
    //    Si ambos quedan vacíos, resetear estado.
    //    Usa barberIdSignal/dateSignal (NO formValue) para no
    //    re-disparar al cambiar time, clientName, phone, etc.
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

  private hydrate(a: Appointment): void {
    this.form.patchValue({
      serviceId:  a.serviceId,
      barberId:   a.barberId,
      date:       a.date,
      time:       a.time,
      clientName: a.clientName,
      phone:      a.phone,
      email:      a.email,
      notes:      a.notes,
    });
  }

  // --- Navegación del stepper ---
  protected next(): void {
    this.errorMsg.set(null);
    const s = this.currentStep();
    if (!this.canAdvance()) {
      this.form.markAllAsTouched();
      return;
    }
    if (s < 3) this.currentStep.set((s + 1) as Step);
  }

  protected back(): void {
    const s = this.currentStep();
    if (s > 1) this.currentStep.set((s - 1) as Step);
  }

  protected goTo(step: Step): void {
    // Solo permite saltar a pasos ya "desbloqueados"
    if (step <= this.currentStep()) this.currentStep.set(step);
  }

  // --- Helpers de selección (setean el form + autoavanzan) ---
  protected selectService(id: number): void {
    this.form.controls.serviceId.setValue(id);
    this.form.controls.serviceId.markAsTouched();
  }

  protected selectBarber(id: number): void {
    this.form.controls.barberId.setValue(id);
    this.form.controls.barberId.markAsTouched();
    // El horario anterior ya no es necesariamente válido para el nuevo
    // barbero. Resetear time y desmarcarlo como touched.
    this.form.controls.time.setValue('');
    this.form.controls.time.markAsUntouched();
  }

  /**
   * Handler de cambio en el input de fecha. Resetea `time` porque
   * el horario previamente elegido puede no estar disponible
   * en la nueva fecha.
   */
  protected onDateChange(): void {
    this.form.controls.time.setValue('');
    this.form.controls.time.markAsUntouched();
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

  // --- Submit ---
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
        // Filtra nulls porque update() toma Partial<AppointmentDraft>
        const patch = Object.fromEntries(
          Object.entries(v).filter(([, val]) => val !== null),
        );
        const updated = await this.appts.update(id, patch);
        if (!updated) throw new Error(this.appts.error() ?? 'No se pudo actualizar');
      } else {
        const created = await this.appts.create({
          ...v,
          serviceId: v.serviceId!,
          barberId:  v.barberId!,
          status:    'pendiente' as AppointmentStatus,
        });
        if (!created) throw new Error(this.appts.error() ?? 'No se pudo crear');
      }
      this.router.navigate(['/citas']);
    } catch (e) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      this.submitting.set(false);
    }
  }

  protected getDateMin(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Genera slots cada N minutos entre startHour y endHour (24h). */
function generateTimeSlots(startHour: number, endHour: number, stepMin: number): string[] {
  const slots: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}
