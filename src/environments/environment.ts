/**
 * Environment de DESARROLLO (npm start).
 *
 * El build de producción sustituye este archivo por
 * `environment.prod.ts` mediante fileReplacement (angular.json).
 *
 * En desarrollo:
 *   - useSupabase = false → json-server local (apiUrl)
 *   - Las credenciales supabase son placeholders, no se usan
 */
export const environment = {
  production: false,
  useSupabase: false,
  apiUrl: 'http://127.0.0.1:3001',
  supabase: {
    url: 'http://localhost:54321',
    publishableKey: 'placeholder-dev-not-used',
  },
};
