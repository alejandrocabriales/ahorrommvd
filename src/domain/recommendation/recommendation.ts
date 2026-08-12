import { PaymentType } from '../../../generated/prisma/client';

/**
 * Una opción concreta para recomendar — comercio + banco + descuento. Nunca
 * se afirma "cerca tuyo" salvo que `neighborhood` venga con dato real: no
 * tenemos coordenadas cargadas para ninguna sucursal todavía (128/132
 * cadenas ni siquiera tienen una sucursal con dirección en la base).
 */
export interface RecommendationOption {
  merchantChainName: string;
  branchName: string | null;
  neighborhood: string | null;
  bankName: string;
  discountPercentage: number;
  paymentType: PaymentType;
  cardName: string | null;
}

export interface BetterSoon {
  option: RecommendationOption;
  daysFromNow: number;
  /** Mismo cálculo que `Recommendation.estimatedSavingToday`, pero para la opción de esperar — permite comparar $ hoy contra $ esperando, no solo %. Solo si conocemos spentAmount. */
  estimatedSaving: { amount: number; cappedByBank: boolean } | null;
}

/**
 * Contrato único que arma el Recommendation Engine (sin IA, puro backend) y
 * que consume el Response Generator (IA) para redactar — mismo shape sin
 * importar si el usuario preguntó por un comercio puntual o por categoría.
 * "La IA solo transforma esto en una conversación natural, nunca decide
 * promociones."
 */
export interface Recommendation {
  /** Qué preguntó el usuario, tal cual lo entendimos (ej. "Ta-Ta Pocitos", "Restaurantes"). */
  queryLabel: string;
  /** Barrio que el usuario mencionó, si lo hizo — informativo, NO implica que filtramos por cercanía real. */
  zone: string | null;
  bestToday: RecommendationOption | null;
  /** Hasta 3 opciones más, sin incluir bestToday. */
  alternatives: RecommendationOption[];
  /** Si existe una opción mejor en los próximos 7 días que le gana a bestToday. */
  betterSoon: BetterSoon | null;
  /** Solo si conocemos un monto real (el usuario lo dijo) — nunca un monto inventado. */
  estimatedSavingToday: { amount: number; cappedByBank: boolean } | null;
  /** true si no hay nada vigente hoy ni en los próximos 7 días. */
  nothingFound: boolean;
  /** Monto que dijo el usuario que piensa gastar, si lo dijo — junto con estimatedSavingToday le permite al Response Generator decir cuánto terminaría pagando, no solo cuánto ahorra. */
  spentAmount: number | null;
}
