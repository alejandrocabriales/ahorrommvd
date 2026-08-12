/**
 * Sucursal real encontrada por un proveedor externo (Google Places u otro) —
 * distinto de `Branch` (el modelo de Prisma): esto es el dato crudo antes de
 * decidir cómo guardarlo. `name` puede repetirse entre sucursales de la
 * misma cadena (ej. dos locales sin sufijo de barrio en el nombre); quien
 * consume esto se encarga de desambiguar antes de persistir.
 */
export interface BranchCandidate {
  name: string;
  address: string;
  neighborhood: string | null;
  latitude: number;
  longitude: number;
}
