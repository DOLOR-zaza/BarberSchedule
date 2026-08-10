/**
 * Environment de PRODUCCIÓN (ng build / GitHub Pages).
 *
 * ⚠️ Esta es la SUPABASE PUBLISHABLE KEY.
 *    Segura de exponer en frontend (limitada por RLS de V24.0).
 *    La `service_role` key NUNCA debe estar aquí (esa es para n8n).
 *
 * 📝 Reemplaza url y publishableKey con tus valores reales
 *    (Supabase → Settings → API).
 */
export const environment = {
  production: true,
  useSupabase: true,
  apiUrl: '', // no se usa en producción
  supabase: {
    url: 'https://agpfjlvskfwsiyqdjpmk.supabase.co',
    publishableKey: 'sb_publishable_OoG7U-537knQ7EfORGidnA_WfaJsa4C',
  },
};
