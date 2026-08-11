/** Las 3 únicas categorías del MVP (spec). Nombres exactos como están seedeados en `Category`. */
export const MVP_CATEGORY_NAMES = [
  'Supermercados',
  'Farmacias',
  'Restaurantes',
] as const;
export type MvpCategoryName = (typeof MVP_CATEGORY_NAMES)[number];
