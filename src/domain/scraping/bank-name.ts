/** Los 3 únicos bancos del MVP (spec). Nombres exactos como están seedeados en `Bank`. */
export const MVP_BANK_NAMES = ['Itaú', 'Santander', 'OCA'] as const;
export type MvpBankName = (typeof MVP_BANK_NAMES)[number];
