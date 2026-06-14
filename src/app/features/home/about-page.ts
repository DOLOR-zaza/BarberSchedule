import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-about-page',
  template: `
    <section class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 class="text-5xl font-display font-bold mb-6">Acerca de</h1>
      <div class="glass rounded-2xl p-8 space-y-4 text-ink-300 leading-relaxed">
        <p>
          <strong class="text-brand-300">BarberSchedule</strong> es un sistema de gestión
          de citas para barbería, construido como proyecto académico con
          Angular 21 + Tailwind v4.
        </p>
        <p>
          Permite administrar citas, catálogo de servicios, equipo de barberos
          y una asistente virtual (BarberBot) para orientar al cliente.
        </p>
        <p class="text-sm text-ink-500 italic">
          Proyecto universitario · Microproyecto · {{ 2026 }}
        </p>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutPage {}
