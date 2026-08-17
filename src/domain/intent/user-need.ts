import { MvpCategoryName } from '../scraping/mvp-category';

/**
 * Qué NECESITA hacer el usuario, en sus términos — no en los del catálogo.
 * "Quiero comer" y "necesito arroz y tomate" son dos necesidades distintas
 * aunque las dos hablen de comida; la primera se resuelve en un
 * restaurante/rotisería y la segunda en un supermercado.
 *
 * Es la capa que faltaba: antes la IA elegía directamente una de las 3
 * categorías del catálogo (`MvpCategoryName`), así que la necesidad y el
 * dónde-se-resuelve eran la misma cosa y no había lugar para una necesidad
 * que cruce dos categorías (o que no tengamos cubierta todavía).
 *
 * Las promociones NO cuelgan de esto: siguen siendo la capa transversal de
 * siempre (`Promotion` -> `MerchantChain` -> `Category`). Una necesidad solo
 * decide EN QUÉ comercios tiene sentido buscar; el motor de promociones que
 * corre después es el mismo para todas.
 */
export const USER_NEEDS = [
  /** Comida ya preparada: restaurante, rotisería, pedir algo, salir a comer. */
  'prepared_food',
  /** Hacer la compra: productos de almacén/frescos para cocinar en casa. */
  'grocery',
  /** Limpieza e higiene/cuidado personal — se consigue tanto en súper como en farmacia. */
  'household',
  /** Medicamentos y farmacia propiamente dicha. */
  'pharmacy',
  /** Ropa, calzado, electro, regalos, tienda. */
  'shopping',
  /** Nafta/gasoil, estaciones de servicio. */
  'fuel',
  /** Servicios (peluquería, gimnasio, taller, etc.). */
  'services',
] as const;

export type UserNeed = (typeof USER_NEEDS)[number];

/**
 * Dónde se resuelve cada necesidad con el catálogo que REALMENTE tenemos
 * cargado. `[]` no es un olvido: es la manera explícita de decir "esta
 * necesidad existe, la entendemos, y no tenemos comercios ni promos para
 * responderla" — el bot lo dice tal cual en vez de forzarla a la categoría
 * más parecida (pedir una ferretería no puede terminar en una recomendación
 * de supermercado).
 *
 * `household` mapea a dos categorías a propósito: el shampoo o el detergente
 * están tanto en Ta-Ta como en Farmashop, y quedarnos con una sola sería
 * descartar promos reales por una decisión de taxonomía nuestra.
 */
const CATEGORIES_BY_NEED: Record<UserNeed, readonly MvpCategoryName[]> = {
  prepared_food: ['Restaurantes'],
  grocery: ['Supermercados'],
  household: ['Supermercados', 'Farmacias'],
  pharmacy: ['Farmacias'],
  shopping: [],
  fuel: [],
  services: [],
};

/**
 * Cómo nombramos la necesidad cuando le hablamos al usuario. Redactado para
 * entrar en frases del tipo "no encontré descuentos vigentes para X" y
 * "todavía no tengo nada de X".
 */
const NEED_LABELS: Record<UserNeed, string> = {
  prepared_food: 'lugares para comer',
  grocery: 'supermercados',
  household: 'artículos de limpieza y cuidado personal',
  pharmacy: 'farmacias',
  shopping: 'ropa y artículos de tienda',
  fuel: 'combustible',
  services: 'servicios',
};

export function categoriesForNeed(need: UserNeed): readonly MvpCategoryName[] {
  return CATEGORIES_BY_NEED[need];
}

/** false = la entendemos pero no tenemos comercios/promos con que responderla. */
export function isNeedCovered(need: UserNeed): boolean {
  return CATEGORIES_BY_NEED[need].length > 0;
}

export function needLabel(need: UserNeed): string {
  return NEED_LABELS[need];
}
