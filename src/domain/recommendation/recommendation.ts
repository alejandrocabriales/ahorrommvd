import { PaymentType } from '../../../generated/prisma/client';

/**
 * Una opción concreta para recomendar — comercio + banco + descuento. Nunca
 * se afirma "cerca tuyo" salvo que `neighborhood`/`address` vengan con dato
 * real: en la recomendación por categoría se llenan solo cuando sabemos el
 * barrio del usuario y elegimos la sucursal verificada más cercana.
 */
export interface RecommendationOption {
  merchantChainName: string;
  branchName: string | null;
  neighborhood: string | null;
  /** Dirección real de la sucursal, si la tenemos cargada — para responder "¿dónde está?" sin inventar. */
  address: string | null;
  bankName: string;
  discountPercentage: number;
  paymentType: PaymentType;
  cardName: string | null;
}

/**
 * Beneficio real que no es un porcentaje — hoy, los 2x1 que Itaú publica en
 * heladerías. No entra al ranking de `bestToday` a propósito: un 2x1 no se
 * puede ordenar contra un 25% sin inventar una equivalencia (depende de qué
 * lleve el usuario). Se ofrece como lo que es, con el texto del banco.
 */
export interface LabeledBenefit {
  merchantChainName: string;
  branchName: string | null;
  neighborhood: string | null;
  address: string | null;
  bankName: string;
  /** Tal cual lo publica el banco: "2x1 en helados de litro y cucuruchos grandes". */
  label: string;
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
  /** true si el usuario preguntó explícitamente dónde queda el comercio — le dice al Response Generator que priorice `bestToday.address` en vez de repetir el descuento, o que sea honesto si no tenemos esa dirección cargada. */
  asksLocation: boolean;
  /**
   * true cuando hay promos vigentes de la categoría pero NINGUNA cadena
   * tiene sucursal verificada en Montevideo — no recomendamos ninguna
   * (spec del usuario: "si no tiene nada, no debe inventar"). Va siempre
   * junto con `nothingFound: true`, y sirve para explicar por qué no hay
   * recomendación: no es que no existan promos, es que no podemos
   * confirmar que esos comercios estén en Montevideo (caso real:
   * Soho/Punta del Este y Chajá, las únicas de Restaurantes para un
   * usuario Itaú+OCA). Solo aplica a la recomendación por categoría — una
   * búsqueda por comercio puntual siempre queda en false, ahí el usuario
   * ya eligió qué quiere.
   */
  unverifiedOnly: boolean;
  /**
   * La mejor opción de hoy en un banco que el usuario NO tiene, con el
   * mismo estándar que una recomendación real (sucursal verificada y cerca
   * si sabemos el barrio). Solo se llena cuando con sus tarjetas no hay
   * nada: convierte un "no tengo nada" seco en "con tus tarjetas no, pero
   * con Santander hay 25% acá al lado". No es una recomendación — no puede
   * usarla salvo que consiga esa tarjeta — así que nunca reemplaza a
   * `bestToday`.
   */
  bestWithOtherBank: RecommendationOption | null;
  /**
   * Beneficios vigentes hoy que no son un %, con sus tarjetas y con local
   * confirmado cerca. Van aparte de `bestToday`/`alternatives` porque no
   * compiten con un porcentaje. Vacío en la búsqueda por comercio puntual.
   */
  otherBenefits: LabeledBenefit[];
  /**
   * true si sabíamos el barrio del usuario pero ninguna sucursal
   * verificada queda dentro del radio de cercanía — lo que ofrecemos está
   * confirmado en Montevideo, pero en otra parte de la ciudad. El Response
   * Generator tiene que decirlo, no hacer pasar la opción por "cerca tuyo".
   */
  zoneWidened: boolean;
}
