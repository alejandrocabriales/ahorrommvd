/**
 * Eval de calidad de la interpretación NLU contra OpenRouter DE VERDAD (no
 * mockeado) — corre una tanda de mensajes con la respuesta esperada y mide
 * cuántos campos extrae bien. Sirve para comparar antes/después de tocar el
 * prompt, el schema o el modelo (ej. "¿cambiar a gpt-4o-mini empeora esto?").
 *
 * No es un test unitario (pega a la red real, cuesta plata, puede ser no
 * determinístico) — por eso vive fuera de `npm test` como script manual.
 * Uso: npm run ai:test
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { OpenRouterMessageInterpreter } from './openrouter-message-interpreter.service';

function intent(overrides: Partial<ParsedIntent>): ParsedIntent {
  return {
    merchantName: null,
    branchHint: null,
    need: null,
    items: [],
    zone: null,
    city: null,
    amount: null,
    banks: null,
    showAllBanks: false,
    wantsGeneralSavings: false,
    confirmsRecommendation: false,
    prefersToWait: false,
    asksLocation: false,
    ...overrides,
  };
}

interface EvalCase {
  message: string;
  expected: ParsedIntent;
}

const CASES: EvalCase[] = [
  {
    message: 'Ta-Ta Pocitos',
    expected: intent({ merchantName: 'Ta-Ta', branchHint: 'Pocitos' }),
  },
  {
    message: 'tata 4000',
    expected: intent({ merchantName: 'tata', amount: 4000 }),
  },
  {
    message: 'Voy al súper',
    expected: intent({ need: 'grocery' }),
  },
  {
    message: 'Necesito una farmacia',
    expected: intent({ need: 'pharmacy' }),
  },
  {
    message: 'Quiero comer algo rico',
    expected: intent({ need: 'prepared_food' }),
  },
  {
    // El caso fundacional de la necesidad: nombra productos, NO un tipo de
    // comercio. Con la versión vieja (la IA elegía la categoría directo) esto
    // no tenía a dónde caer.
    message: 'Necesito comprar arroz y tomate',
    expected: intent({ need: 'grocery', items: ['arroz', 'tomate'] }),
  },
  {
    message: 'Necesito comprar arroz y tomate y tengo una tarjeta Itaú',
    expected: intent({
      need: 'grocery',
      items: ['arroz', 'tomate'],
      banks: ['Itaú'],
    }),
  },
  {
    // Misma familia (comida) que el anterior, necesidad distinta: acá quiere
    // comida ya hecha, no ingredientes.
    message: 'Quiero comer',
    expected: intent({ need: 'prepared_food' }),
  },
  {
    message: 'me falta leche y fideos',
    expected: intent({ need: 'grocery', items: ['leche', 'fideos'] }),
  },
  {
    message: 'necesito shampoo y papel higiénico',
    expected: intent({
      need: 'household',
      items: ['shampoo', 'papel higiénico'],
    }),
  },
  {
    message: 'quiero comprar una camisa',
    expected: intent({ need: 'shopping', items: ['camisa'] }),
  },
  {
    message: 'quiero cargar combustible',
    expected: intent({ need: 'fuel' }),
  },
  {
    message: 'Voy a Punta Carretas',
    expected: intent({ zone: 'Punta Carretas' }),
  },
  {
    message: 'vivo en Maldonado',
    expected: intent({ city: 'Maldonado' }),
  },
  {
    message: 'ando por Punta del Este, qué me conviene',
    expected: intent({ city: 'Punta del Este', wantsGeneralSavings: true }),
  },
  {
    message: 'quiero comer algo, estoy en Barrio Sur',
    expected: intent({ need: 'prepared_food', zone: 'Barrio Sur' }), // barrio de Montevideo, NUNCA va en city
  },
  {
    message: 'tengo Itaú y Santander',
    expected: intent({ banks: ['Itaú', 'Santander'] }),
  },
  { message: 'mi tarjeta es OCA', expected: intent({ banks: ['OCA'] }) },
  {
    message: 'tengo Scotiabank',
    expected: intent({}), // fuera de scope MVP -> se ignora, no se inventa
  },
  {
    message: 'tengo Itaú, Ta-Ta Pocitos',
    expected: intent({
      merchantName: 'Ta-Ta',
      branchHint: 'Pocitos',
      banks: ['Itaú'],
    }),
  },
  {
    message: 'dame todas las ofertas',
    expected: intent({ showAllBanks: true }),
  },
  {
    message: 'mostrame todas las promos de farmacias',
    expected: intent({ need: 'pharmacy', showAllBanks: true }),
  },
  {
    message: 'quiero comer de todo, tengo hambre',
    expected: intent({ need: 'prepared_food' }), // "de todo" != pedir todos los bancos
  },
  {
    message: 'Farmashop 1500',
    expected: intent({ merchantName: 'Farmashop', amount: 1500 }),
  },
  {
    message: 'quiero ahorrar hoy',
    expected: intent({ wantsGeneralSavings: true }),
  },
  {
    message: 'qué me conviene hacer',
    expected: intent({ wantsGeneralSavings: true }),
  },
  {
    // Bug real en vivo: esto se estaba interpretando como wantsGeneralSavings
    // y terminaba mezclando Restaurantes + Farmacias en la respuesta, como
    // si el usuario hubiese pedido "lo mejor de todo Montevideo". Una
    // verdulería es alimentos -> grocery; el backend resuelve dónde.
    message: 'necesito buscar descuentos en verdulerías',
    expected: intent({ need: 'grocery' }),
  },
  {
    // Ferretería NO es grocery por parecido: es una necesidad que entendemos
    // y no podemos responder todavía, y eso hay que poder decirlo.
    message: 'dónde hay una ferretería con descuento',
    expected: intent({ need: 'shopping' }),
  },
  {
    message: 'tengo que hacer el súper',
    expected: intent({ need: 'grocery' }),
  },
  {
    message: 'quiero salir a comer',
    expected: intent({ need: 'prepared_food' }),
  },
  { message: 'hola', expected: intent({}) },
  {
    message: 'Devoto Malvin',
    expected: intent({ merchantName: 'Devoto', branchHint: 'Malvin' }),
  },
  {
    message: 'me sirve',
    expected: intent({ confirmsRecommendation: true }),
  },
  {
    message: 'dale, voy ahora',
    expected: intent({ confirmsRecommendation: true }),
  },
  {
    message: 'mañana entonces',
    expected: intent({ prefersToWait: true }),
  },
  {
    message: 'y mañana?',
    expected: intent({ prefersToWait: true }),
  },
  {
    // Caso real reportado en producción: esto tiraba "no entendí" porque
    // merchantName no se extraía en una pregunta de ubicación.
    message: 'Chajá donde esta?',
    expected: intent({ merchantName: 'Chajá', asksLocation: true }),
  },
  {
    message: '¿dónde queda Ta-Ta?',
    expected: intent({ merchantName: 'Ta-Ta', asksLocation: true }),
  },
  {
    message: 'en qué dirección está Farmashop Pocitos',
    expected: intent({
      merchantName: 'Farmashop',
      branchHint: 'Pocitos',
      asksLocation: true,
    }),
  },
  {
    message: 'mejor espero, no es urgente',
    expected: intent({ prefersToWait: true }),
  },
  {
    // Trae comercio propio -> no es una confirmación de lo anterior, es un tema nuevo.
    message: 'dale, y Devoto?',
    expected: intent({ merchantName: 'Devoto' }),
  },
];

interface FieldDiff {
  field: string;
  expected: unknown;
  actual: unknown;
}

function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (Array.isArray(value)) return [...value].map(normalize).sort();
  return value;
}

function diffFields(expected: ParsedIntent, actual: ParsedIntent): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of Object.keys(expected) as (keyof ParsedIntent)[]) {
    const exp = normalize(expected[field]);
    const act = normalize(actual[field]);
    if (JSON.stringify(exp) !== JSON.stringify(act)) {
      diffs.push({ field, expected: expected[field], actual: actual[field] });
    }
  }
  return diffs;
}

async function main() {
  // Stub liviano en vez de instanciar ConfigService "pelado" (su default
  // interno no está documentado) — este script no levanta ConfigModule, solo
  // necesita leer process.env después de `import 'dotenv/config'`.
  const configService = {
    get: (key: string) => process.env[key],
    getOrThrow: (key: string) => {
      const value = process.env[key];
      if (!value) throw new Error(`Falta ${key} en .env`);
      return value;
    },
  } as unknown as ConfigService;

  const interpreter = new OpenRouterMessageInterpreter(configService);

  let fieldsTotal = 0;
  let fieldsOk = 0;
  let casesOk = 0;

  for (const { message, expected } of CASES) {
    const actual = await interpreter.interpret(message);
    const diffs = diffFields(expected, actual);

    fieldsTotal += Object.keys(expected).length;
    fieldsOk += Object.keys(expected).length - diffs.length;
    if (diffs.length === 0) casesOk++;

    const status = diffs.length === 0 ? 'OK  ' : 'FAIL';
    console.log(`[${status}] "${message}"`);
    for (const d of diffs) {
      console.log(
        `        ${d.field}: esperado=${JSON.stringify(d.expected)} obtenido=${JSON.stringify(d.actual)}`,
      );
    }
  }

  const casePct = ((casesOk / CASES.length) * 100).toFixed(0);
  const fieldPct = ((fieldsOk / fieldsTotal) * 100).toFixed(0);
  console.log('');
  console.log(`Casos exactos: ${casesOk}/${CASES.length} (${casePct}%)`);
  console.log(`Campos correctos: ${fieldsOk}/${fieldsTotal} (${fieldPct}%)`);

  // Umbral bajo a propósito (el LLM no es determinístico) — el objetivo es
  // detectar una regresión grande, no exigir 100%.
  if (casesOk / CASES.length < 0.85) {
    console.error(
      '\nAccuracy por debajo del umbral (85%) — revisar prompt/schema/modelo.',
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
