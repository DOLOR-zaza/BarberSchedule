import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';

type ViewMode = 'login' | 'forgot' | 'password';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly recoveryRequested =
    this.route.snapshot.queryParamMap.get('recovery') === '1';

  protected readonly mode = signal<ViewMode>('login');
  protected readonly notice = signal<string | null>(null);
  protected readonly passwordVisible = signal(false);
  protected readonly confirmPasswordVisible = signal(false);

  protected readonly signedInAdmin = computed(
    () => this.auth.isAuthenticated() && this.auth.isAdmin(),
  );

  protected readonly loginForm = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected readonly resetForm = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
  });

  protected readonly passwordForm = new FormGroup({
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
    confirmPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });

  constructor() {
    effect(() => {
      const loading = this.auth.loading();
      const authenticated = this.auth.isAuthenticated();
      const recoveryEvent = this.auth.passwordRecovery();

      if (loading) {
        return;
      }

      if (recoveryEvent || (this.recoveryRequested && authenticated)) {
        this.auth.clearError();
        this.mode.set('password');
        return;
      }

      if (this.recoveryRequested && !authenticated) {
        this.mode.set('forgot');
        this.auth.error.set(
          'El enlace de recuperación no tiene una sesión válida. ' +
          'Puede haber expirado o ya haberse utilizado. Solicita uno nuevo.',
        );
      }
    });
  }

  protected async submitLogin(): Promise<void> {
    this.notice.set(null);
    this.auth.clearError();

    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const { email, password } = this.loginForm.getRawValue();
    const ok = await this.auth.signIn(email, password);

    if (ok) {
      this.notice.set('Sesión de administrador iniciada correctamente.');
      this.loginForm.controls.password.reset('');
    }
  }

  protected async submitReset(): Promise<void> {
    this.notice.set(null);
    this.auth.clearError();

    if (this.resetForm.invalid) {
      this.resetForm.markAllAsTouched();
      return;
    }

    const { email } = this.resetForm.getRawValue();
    const ok = await this.auth.sendPasswordReset(email);

    if (ok) {
      this.notice.set(
        'Te enviamos un correo para establecer o recuperar tu contraseña.',
      );
    }
  }

  protected async submitPassword(): Promise<void> {
    this.notice.set(null);
    this.auth.clearError();

    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    const { password, confirmPassword } = this.passwordForm.getRawValue();

    if (password !== confirmPassword) {
      this.auth.error.set('Las contraseñas no coinciden.');
      return;
    }

    const ok = await this.auth.updatePassword(password);

    if (!ok) {
      return;
    }

    await this.auth.refreshAdminStatus();

    this.notice.set('Contraseña actualizada correctamente.');
    this.passwordForm.reset();
    this.mode.set('login');
  }

  protected async logout(): Promise<void> {
    this.notice.set(null);
    await this.auth.signOut();
    this.mode.set('login');
  }

  protected showLogin(): void {
    this.notice.set(null);
    this.auth.clearError();
    this.mode.set('login');
  }

  protected showForgot(): void {
    this.notice.set(null);
    this.auth.clearError();

    const loginEmail = this.loginForm.controls.email.value;
    if (loginEmail) {
      this.resetForm.controls.email.setValue(loginEmail);
    }

    this.mode.set('forgot');
  }

  protected togglePassword(): void {
    this.passwordVisible.update((value) => !value);
  }

  protected toggleConfirmPassword(): void {
    this.confirmPasswordVisible.update((value) => !value);
  }

  protected goHome(): void {
    void this.router.navigate(['/inicio']);
  }
}
