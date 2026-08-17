/**
 * Eval de calidad de la REDACCIÓN contra OpenRouter DE VERDAD (no
 * mockeado) — mismo espíritu que nlu-eval.script.ts pero para el Response
 * Generator: le pasamos Recommendation ya armadas (sin pasar por el
 * motor) y chequeamos propiedades del texto que redacta (no un match
 * exacto — es texto libre, no JSON estructurado). Sirve para detectar
 * regresiones de prompt antes de que lleguen a producción — nació de dos
 * bugs reales encontrados en vivo esta misma vuelta: un tope mal explicado
 * y un barrio preguntado explícitamente que la respuesta ignoraba.
 *
 * No es un test unitario (pega a la red real, cuesta plata, puede ser no
 * determinístico) — por eso vive fuera de `npm test` como script manual.
 * Uso: npm run ai:test:response
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PaymentType } from '../../../generated/prisma/client';
import { Recommendation } from '../../domain/recommendation/recommendation';
import { OpenRouterResponseGenerator } from './openrouter-response-generator.service';

function recommendation(overrides: Partial<Recommendation>): Recommendation {
  return {
    queryLabel: 'farmacias',
    requestedItems: [],
    zone: null,
    bestToday: null,
    alternatives: [],
    betterSoon: null,
    estimatedSavingToday: null,
    nothingFound: false,
    spentAmount: null,
    asksLocation: false,
    unverifiedOnly: false,
    zoneWidened: false,
    bestWithOtherBank: null,
    otherBenefits: [],
    ...overrides,
  };
}

const FARMASHOP: Recommendation['bestToday'] = {
  merchantChainName: 'Farmashop',
  branchName: null,
  neighborhood: null,
  address: null,
  bankName: 'Itaú',
  discountPercentage: 15,
  paymentType: PaymentType.CREDITO,
  cardName: 'Itaú Visa',
};

const BANNED_WORDS = ['bo', 'che', 'salado', 'guita', 'gurí'];
const ROBOT_PHRASES = [
  'estimado usuario',
  'con gusto puedo ayudarte',
  'según la información disponible',
];

interface Check {
  name: string;
  predicate: (text: string) => boolean;
}

interface EvalCase {
  label: string;
  recommendation: Recommendation;
  checks: Check[];
}

function noBannedWords(): Check {
  return {
    name: 'sin modismos de caricatura (bo/che/salado/guita/gurí)',
    predicate: (text) => {
      const lower = text.toLowerCase();
      return !BANNED_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(lower));
    },
  };
}

function noRobotPhrases(): Check {
  return {
    name: 'sin frases de robot formal',
    predicate: (text) => {
      const lower = text.toLowerCase();
      return !ROBOT_PHRASES.some((p) => lower.includes(p));
    },
  };
}

/**
 * Bug real en vivo: "asksLocation" contestaba reabriendo el pitch completo
 * del descuento (comercio + banco + % + oferta de calcular ahorro) casi
 * calcado al mensaje anterior, en vez de una respuesta corta y puntual
 * sobre la ubicación. Tope de palabras como proxy de "no repitas todo".
 */
function isConcise(maxWords: number): Check {
  return {
    name: `es corta (<= ${maxWords} palabras, no repite el pitch completo)`,
    predicate: (text) => text.trim().split(/\s+/).length <= maxWords,
  };
}

const CASES: EvalCase[] = [
  {
    label:
      'zone sin neighborhood en las opciones -> igual debe mencionar el barrio (bug encontrado en vivo)',
    recommendation: recommendation({
      zone: 'Pocitos',
      bestToday: FARMASHOP,
      alternatives: [
        {
          ...FARMASHOP,
          merchantChainName: 'Ta-Ta',
          discountPercentage: 10,
          bankName: 'Itaú',
          cardName: 'Itaú Mastercard',
        },
      ],
    }),
    checks: [
      {
        name: 'menciona "pocitos"',
        predicate: (t) => t.toLowerCase().includes('pocitos'),
      },
      noBannedWords(),
      noRobotPhrases(),
    ],
  },
  {
    label:
      'tope aplicado -> debe explicar % teórico vs ahorro real (bug encontrado en vivo)',
    recommendation: recommendation({
      bestToday: FARMASHOP,
      spentAmount: 6000,
      estimatedSavingToday: { amount: 800, cappedByBank: true },
    }),
    checks: [
      {
        name: 'menciona "tope"',
        predicate: (t) => t.toLowerCase().includes('tope'),
      },
      {
        name: 'dice el monto real ($800)',
        predicate: (t) => t.includes('800'),
      },
      noBannedWords(),
      noRobotPhrases(),
    ],
  },
  {
    label:
      'betterSoon con estimatedSaving -> debe comparar $ directo, no solo %',
    recommendation: recommendation({
      bestToday: FARMASHOP,
      spentAmount: 600,
      estimatedSavingToday: { amount: 90, cappedByBank: false },
      betterSoon: {
        option: {
          ...FARMASHOP,
          bankName: 'Santander',
          discountPercentage: 25,
          cardName: 'Santander Free',
        },
        daysFromNow: 3,
        estimatedSaving: { amount: 150, cappedByBank: false },
      },
    }),
    checks: [
      {
        name: 'menciona el ahorro de hoy ($90)',
        predicate: (t) => t.includes('90'),
      },
      {
        name: 'menciona el ahorro esperando ($150)',
        predicate: (t) => t.includes('150'),
      },
      noBannedWords(),
      noRobotPhrases(),
    ],
  },
  {
    label:
      'asksLocation con address conocida -> debe decir la dirección real (caso "Chajá donde esta?")',
    recommendation: recommendation({
      queryLabel: 'Chajá',
      asksLocation: true,
      bestToday: {
        ...FARMASHOP,
        merchantChainName: 'Chajá',
        address: 'Bulevar España 2411',
        neighborhood: 'Pocitos',
      },
    }),
    checks: [
      {
        name: 'dice la dirección real',
        predicate: (t) => t.includes('Bulevar España 2411'),
      },
      isConcise(35),
      noBannedWords(),
      noRobotPhrases(),
    ],
  },
  {
    label:
      'asksLocation con sucursal conocida pero SIN address -> honesto sobre la dirección, sin inventar locales (bug real: "donde queda Soho?" -> "buscá el más cercano")',
    recommendation: recommendation({
      queryLabel: 'Chajá',
      asksLocation: true,
      bestToday: {
        ...FARMASHOP,
        merchantChainName: 'Chajá',
        branchName: 'Chajá Pocitos',
        neighborhood: 'Pocitos',
      },
    }),
    checks: [
      {
        name: 'reconoce que no tiene la dirección (no solo repite el %)',
        predicate: (t) => {
          const lower = t.toLowerCase();
          return (
            lower.includes('no tengo') ||
            lower.includes('no cuento con') ||
            lower.includes('dirección') ||
            lower.includes('cargada')
          );
        },
      },
      {
        name: 'no da por hecho locales que no tenemos ("cualquier local", "el más cercano")',
        predicate: (t) => {
          const lower = t.toLowerCase();
          return (
            !lower.includes('cualquier local') && !lower.includes('más cercano')
          );
        },
      },
      isConcise(35),
      noBannedWords(),
      noRobotPhrases(),
    ],
  },
  {
    label:
      'zoneWidened -> debe admitir que en el barrio del usuario no hay nada y que lo que ofrece queda en otra parte de Montevideo (bug real: "no tengo opciones en Buceo, pero aplica en cualquier local")',
    recommendation: recommendation({
      queryLabel: 'lugares para comer',
      zone: 'Buceo',
      bestToday: {
        ...FARMASHOP,
        merchantChainName: 'Porto Vanila',
        branchName: 'Porto Vanila Ciudad Vieja',
        neighborhood: 'Ciudad Vieja',
        address: 'Pérez Castellano 1422, Montevideo',
        bankName: 'Santander',
        discountPercentage: 25,
      },
      zoneWidened: true,
    }),
    checks: [
      {
        name: 'nombra el barrio del usuario y admite que la opción está en otro lado',
        predicate: (t) => {
          const lower = t.toLowerCase();
          return (
            lower.includes('buceo') &&
            (lower.includes('ciudad vieja') ||
              lower.includes('no tengo') ||
              lower.includes('lo más cerca'))
          );
        },
      },
      {
        name: 'no tapa la distancia con "aplica en cualquier local"',
        predicate: (t) => !t.toLowerCase().includes('cualquier local'),
      },
      noBannedWords(),
      noRobotPhrases(),
    ],
  },
  {
    label:
      'requestedItems -> contesta lo que el usuario pidió (arroz y tomate) sin inventar precios ni stock',
    recommendation: recommendation({
      queryLabel: 'supermercados',
      requestedItems: ['arroz', 'tomate'],
      zone: 'Pocitos',
      bestToday: {
        ...FARMASHOP,
        merchantChainName: 'Ta-Ta',
        branchName: 'Ta-Ta Pocitos',
        neighborhood: 'Pocitos',
        address: 'Av. Brasil 2846, Montevideo',
        bankName: 'Santander',
        discountPercentage: 20,
      },
    }),
    checks: [
      {
        name: 'menciona los productos que pidió',
        predicate: (t) => {
          const lower = t.toLowerCase();
          return lower.includes('arroz') || lower.includes('tomate');
        },
      },
      {
        name: 'no inventa precios de productos (no tenemos precios por producto)',
        predicate: (t) => !/\$\s?\d/.test(t),
      },
      {
        name: 'recomienda el comercio concreto',
        predicate: (t) => t.toLowerCase().includes('ta-ta'),
      },
      noBannedWords(),
      noRobotPhrases(),
    ],
  },
  {
    label: 'voseo natural sin caricatura (smoke test general)',
    recommendation: recommendation({ bestToday: FARMASHOP }),
    checks: [
      {
        name: 'usa voseo (tenés/podés/decime/etc)',
        predicate: (t) =>
          /\b(ten[eé]s|pod[eé]s|decime|fijate|quer[eé]s|busc[aá]s)\b/i.test(t),
      },
      noBannedWords(),
      noRobotPhrases(),
      {
        name: 'cierra con como mucho una pregunta',
        predicate: (t) => (t.match(/\?/g) ?? []).length <= 1,
      },
    ],
  },
];

async function main() {
  const configService = {
    get: (key: string) => process.env[key],
    getOrThrow: (key: string) => {
      const value = process.env[key];
      if (!value) throw new Error(`Falta ${key} en .env`);
      return value;
    },
  } as unknown as ConfigService;

  const generator = new OpenRouterResponseGenerator(configService);

  let checksTotal = 0;
  let checksOk = 0;

  for (const { label, recommendation: rec, checks } of CASES) {
    const text = await generator.generate(rec);
    console.log(`\n[${label}]`);
    console.log(`"${text}"`);

    for (const check of checks) {
      checksTotal++;
      const ok = check.predicate(text);
      if (ok) checksOk++;
      console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${check.name}`);
    }
  }

  const pct = ((checksOk / checksTotal) * 100).toFixed(0);
  console.log('');
  console.log(`Checks correctos: ${checksOk}/${checksTotal} (${pct}%)`);

  // Umbral bajo a propósito (texto libre, el LLM no es determinístico) —
  // el objetivo es detectar una regresión grande, no exigir 100%.
  if (checksOk / checksTotal < 0.8) {
    console.error(
      '\nCalidad por debajo del umbral (80%) — revisar el prompt del Response Generator.',
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
