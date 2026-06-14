/**
 * Representa a un barbero del equipo.
 * En esta versión los datos vienen de json-server
 * y se simulan localmente, sin auth ni roles complejos.
 */
export interface Barber {
  id: number;
  name: string;
  specialty: string;
  available: boolean;
  avatar: string;   // emoji o URL de imagen
  experience: number; // años de experiencia
}
