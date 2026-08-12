import { MvpCategoryName } from '../scraping/mvp-category';

/**
 * Tipos de Google Places (Table A, "types") aceptables por cada categoría
 * del MVP — guardia contra falsos positivos de Places Text Search: buscar
 * "Soho Montevideo" devuelve, además del comercio real, cualquier negocio
 * sin relación que tenga "Soho" en el nombre o esté en el barrio Soho
 * (probado en vivo: una casa de pinturas, un salón de belleza, una
 * concesionaria). Si el `primaryType`/`types` del resultado no cae en esta
 * lista para la categoría de la cadena, se descarta — mismo criterio
 * conservador que el resto del backfill: mejor faltante que inventado.
 */
export const CATEGORY_PLACE_TYPES: Record<
  MvpCategoryName,
  ReadonlySet<string>
> = {
  Restaurantes: new Set([
    'restaurant',
    'bar',
    'cafe',
    'bakery',
    'meal_takeaway',
    'meal_delivery',
    'fast_food_restaurant',
    'pizza_restaurant',
    'sandwich_shop',
    'coffee_shop',
    'ice_cream_shop',
    'dessert_shop',
    'brunch_restaurant',
    'breakfast_restaurant',
  ]),
  Farmacias: new Set(['pharmacy', 'drugstore']),
  Supermercados: new Set(['supermarket', 'grocery_store']),
};
