/**
 * Servicio del catálogo (corte, barba, tinte, etc.).
 * La duración está en minutos y se usa para validar
 * que un barbero no tenga citas traslapadas.
 */
export interface BarberService {
  id: number;
  name: string;
  duration: number;  // minutos
  price: number;     // MXN
  icon: string;      // emoji representativo
}
