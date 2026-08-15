import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly supabase = inject(SupabaseService);
  private readonly destroyRef = inject(DestroyRef);

  private adminCheckVersion = 0;

  readonly session = signal<Session | null>(null);
  readonly isAdmin = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly passwordRecovery = signal(false);

  readonly user = computed<User | null>(() => this.session()?.user ?? null);
  readonly isAuthenticated = computed(() => !!this.session());
  readonly email = computed(() => this.user()?.email ?? '');

  constructor() {
    const {
      data: { subscription },
    } = this.supabase.client.auth.onAuthStateChange((event, session) => {
      this.session.set(session);

      if (event === 'PASSWORD_RECOVERY') {
        this.passwordRecovery.set(true);
      }

      if (!session) {
        this.adminCheckVersion++;
        this.isAdmin.set(false);
        this.loading.set(false);
        return;
      }

      // Evita una carrera entre SIGNED_IN y signIn(), que ya valida admin.
      // Recovery y refresh de token si requieren revalidacion automatica.
      if (event === 'PASSWORD_RECOVERY' || event === 'TOKEN_REFRESHED') {
        setTimeout(() => {
          void this.refreshAdminStatus();
        }, 0);
      }
    });

    this.destroyRef.onDestroy(() => subscription.unsubscribe());

    void this.restoreSession();
  }

  async restoreSession(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    const { data, error } = await this.supabase.client.auth.getSession();

    if (error) {
      console.error('Auth restoreSession:', error);
      this.session.set(null);
      this.isAdmin.set(false);
      this.error.set('No se pudo restaurar la sesión. Vuelve a iniciar sesión.');
      this.loading.set(false);
      return;
    }

    this.session.set(data.session);

    if (!data.session) {
      this.isAdmin.set(false);
      this.loading.set(false);
      return;
    }

    await this.refreshAdminStatus();
  }

  async signIn(email: string, password: string): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);
    this.passwordRecovery.set(false);

    const { data, error } =
      await this.supabase.client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

    if (error || !data.session) {
      console.error('Auth signIn:', error);
      this.session.set(null);
      this.isAdmin.set(false);
      this.error.set('Correo o contraseña incorrectos.');
      this.loading.set(false);
      return false;
    }

    this.session.set(data.session);

    const admin = await this.refreshAdminStatus();

    if (!admin) {
      await this.supabase.client.auth.signOut({ scope: 'local' });
      this.session.set(null);
      this.isAdmin.set(false);
      this.error.set('Esta cuenta no tiene permisos de administrador.');
      this.loading.set(false);
      return false;
    }

    this.loading.set(false);
    return true;
  }

  async signOut(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    const { error } = await this.supabase.client.auth.signOut({
      scope: 'local',
    });

    if (error) {
      console.error('Auth signOut:', error);
      this.error.set('No se pudo cerrar la sesión.');
    }

    this.adminCheckVersion++;
    this.session.set(null);
    this.isAdmin.set(false);
    this.passwordRecovery.set(false);
    this.loading.set(false);
  }

  async refreshAdminStatus(): Promise<boolean> {
    const session = this.session();

    if (!session) {
      this.isAdmin.set(false);
      this.loading.set(false);
      return false;
    }

    const version = ++this.adminCheckVersion;

    const { data, error } =
      await this.supabase.client.rpc('is_current_user_admin');

    if (version !== this.adminCheckVersion) {
      return this.isAdmin();
    }

    if (error) {
      console.error('Auth refreshAdminStatus:', error);
      this.isAdmin.set(false);
      this.error.set('No se pudieron verificar los permisos de administrador.');
      this.loading.set(false);
      return false;
    }

    const admin = data === true;
    this.isAdmin.set(admin);
    this.loading.set(false);

    return admin;
  }

  async updatePassword(password: string): Promise<boolean> {
    this.error.set(null);

    if (password.length < 8) {
      this.error.set('La contraseña debe tener al menos 8 caracteres.');
      return false;
    }

    this.loading.set(true);

    // updateUser requiere una sesión autenticada. Validamos antes de
    // intentarlo para mostrar un mensaje útil en lugar de uno genérico.
    const { data: sessionData, error: sessionError } =
      await this.supabase.client.auth.getSession();

    if (sessionError || !sessionData.session) {
      console.error(
        'Auth updatePassword: sesión de recuperación ausente.',
        sessionError,
      );
      this.session.set(null);
      this.isAdmin.set(false);
      this.error.set(
        'Este enlace de recuperación ya no tiene una sesión válida. ' +
        'Puede haber expirado o haberse usado antes. Solicita un enlace nuevo.',
      );
      this.loading.set(false);
      return false;
    }

    this.session.set(sessionData.session);

    const { error } = await this.supabase.client.auth.updateUser({
      password,
    });

    if (error) {
      console.error('Auth updatePassword:', error);

      const message = error.message?.toLowerCase() ?? '';

      if (
        error.name === 'AuthSessionMissingError' ||
        message.includes('auth session missing') ||
        message.includes('session missing')
      ) {
        this.error.set(
          'La sesión del enlace de recuperación ya no es válida. ' +
          'Solicita un enlace nuevo e inténtalo otra vez.',
        );
      } else if (
        message.includes('password') &&
        (message.includes('weak') ||
          message.includes('characters') ||
          message.includes('strength'))
      ) {
        this.error.set(
          'Supabase rechazó esa contraseña. Usa una contraseña más fuerte.',
        );
      } else {
        this.error.set(
          `No se pudo actualizar la contraseña. ${error.message ?? ''}`.trim(),
        );
      }

      this.loading.set(false);
      return false;
    }

    this.passwordRecovery.set(false);
    this.loading.set(false);
    return true;
  }

  async sendPasswordReset(email: string): Promise<boolean> {
    this.error.set(null);
    this.loading.set(true);

    const redirectTo = new URL(
      'login?recovery=1',
      document.baseURI,
    ).toString();

    const { error } =
      await this.supabase.client.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo },
      );

    if (error) {
      console.error('Auth sendPasswordReset:', error);

      const message = error.message?.toLowerCase() ?? '';

      if (
        error.status === 429 ||
        message.includes('rate limit') ||
        message.includes('too many')
      ) {
        this.error.set(
          'Ya se solicitó un enlace recientemente. Revisa tu correo o espera unos minutos antes de pedir otro.',
        );
      } else {
        this.error.set(
          `No se pudo enviar el correo de recuperación. ${error.message ?? ''}`.trim(),
        );
      }

      this.loading.set(false);
      return false;
    }

    this.loading.set(false);
    return true;
  }

  clearError(): void {
    this.error.set(null);
  }
}
