import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MESSAGE_INTERPRETER,
  MessageInterpreter,
} from '../../domain/ai/message-interpreter.port';
import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { MVP_BANK_NAMES } from '../../domain/scraping/bank-name';
import { USER_NEEDS } from '../../domain/intent/user-need';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `Extraés la NECESIDAD de un mensaje de WhatsApp de un usuario en Montevideo, Uruguay, que busca dónde y con qué tarjeta comprar más barato. Tu trabajo es entender QUÉ necesita, no elegir en qué comercio se resuelve — eso lo decide el backend después.

Reglas:
- Nunca inventes un comercio, sucursal, monto o banco que el usuario no haya escrito. Si algo no está en el mensaje, ese campo va null.
- merchantName: nombre de cadena/comercio tal cual lo escribió el usuario, con errores de tipeo incluidos (ej. "tata", "farmashop"). null si no menciona ninguno. Extraelo SIEMPRE que nombre un comercio, incluso si el mensaje es una pregunta de ubicación (ej. "Chajá donde esta?" -> merchantName: "Chajá") — no lo dejes null solo porque la pregunta es sobre dirección en vez de sobre precio.
- branchHint: sucursal o barrio puntual mencionado junto al comercio (ej. "Ta-Ta Pocitos" -> "Pocitos"). null si no aplica.
- need: qué necesita el usuario, SOLO si no nombra un comercio puntual. Uno de "${USER_NEEDS.join('", "')}":
  - prepared_food = comida ya lista: "quiero comer", "tengo hambre", "salir a comer", "pedir algo", "una pizza", "un restaurante", "una rotisería", "algo para cenar ya hecho".
  - grocery = hacer la compra, ingredientes para cocinar en casa: "necesito comprar arroz y tomate", "voy al súper", "tengo que hacer las compras", "me falta leche y fideos", "carne para el asado".
  - household = limpieza, higiene o cuidado personal: "necesito detergente", "shampoo y papel higiénico", "artículos de limpieza", "pañales".
  - pharmacy = medicamentos o farmacia: "necesito una farmacia", "me duele la cabeza, necesito algo", "tengo que comprar un remedio".
  - shopping = ropa, calzado, electro, regalos, tienda: "quiero comprar una camisa", "necesito zapatos", "un regalo".
  - fuel = combustible: "cargar nafta", "una estación de servicio".
  - services = servicios: "una peluquería", "un gimnasio", "un taller mecánico".
  null si el mensaje no pide nada de eso, o si ya hay merchantName.
  DISTINCIÓN CLAVE: "quiero comer" es prepared_food (comida lista) y "quiero comprar arroz y tomate" es grocery (ingredientes) — las dos hablan de comida y NO son lo mismo. Ante la duda, mirá si el usuario nombra productos sueltos (grocery/household) o habla de comer/pedir algo ya hecho (prepared_food).
  Elegí shopping/fuel/services cuando corresponda aunque no tengamos promos ahí: el backend contesta que todavía no tiene nada de eso, y eso es mejor que empujarlo a la necesidad más parecida. NUNCA mandes una necesidad a otra por parecido ("una verdulería" es grocery porque son alimentos, pero "una ferretería" es shopping, no grocery).
- items: lista de PRODUCTOS concretos que el usuario nombró, en singular y tal cual los escribió, sin cantidades ni marcas inventadas (ej. "necesito comprar arroz y tomate" -> ["arroz","tomate"], "me falta leche" -> ["leche"]). [] si no nombra ninguno. Un tipo de comercio NO es un producto ("farmacia", "súper", "restaurante" nunca van acá).
- zone: barrio de Montevideo mencionado sin comercio específico (ej. "voy a Punta Carretas"). null si no aplica.
- city: ciudad o departamento de Uruguay DISTINTO a Montevideo que el usuario dice que es su ubicación (ej. "vivo en Maldonado" -> "Maldonado", "ando por Punta del Este" -> "Punta del Este", "soy de Colonia" -> "Colonia"). NUNCA un barrio de Montevideo — "Pocitos", "Barrio Sur", "Punta Carretas", "Punta Gorda" son barrios, van en zone, no acá. null si no lo dice explícitamente, o si nombra Montevideo mismo (el bot asume Montevideo por default).
- amount: monto en pesos uruguayos si el usuario dice cuánto gastó o va a gastar (ej. "Ta-Ta 4000" -> 4000). null si no menciona monto.
- banks: lista de bancos con los que el usuario dice tener tarjeta, SOLO de "${MVP_BANK_NAMES.join('", "')}" (ej. "tengo Itaú y Santander" -> ["Itaú","Santander"], "mi tarjeta es OCA" -> ["OCA"]). Si menciona un banco que no es ninguno de esos tres, ignoralo. null si no menciona ningún banco en este mensaje.
- showAllBanks: true SOLO si el usuario pide explícitamente ver ofertas de todos los bancos, no solo los suyos (ej. "dame todas las ofertas", "mostrame todo", "todas las promos", "de todos los bancos"). false en cualquier otro caso, incluso si no lo menciona.
- wantsGeneralSavings: true si el usuario pide ahorrar o la mejor opción en general SIN decir qué necesita ni nombrar un comercio (ej. "quiero ahorrar hoy", "qué me conviene hacer", "qué descuento hay hoy", "dame la mejor oferta"). false si ya hay merchantName o need, o si el mensaje no tiene que ver con ahorrar — "necesito descuentos en verdulerías" NO es wantsGeneralSavings aunque diga "descuentos": ahí hay una necesidad (grocery).
- confirmsRecommendation: true SOLO si el mensaje es una aceptación corta de algo que ya se venía hablando, sin nombrar comercio/necesidad propios (ej. "me sirve", "dale", "voy ahora", "listo", "genial, gracias", "ya voy para allá"). false en cualquier otro caso, incluso si el mensaje es positivo pero trae su propio comercio o necesidad.
- prefersToWait: true SOLO si el mensaje dice que prefiere esperar a algo mejor que ya se venía hablando, O pregunta explícitamente por esa mejora futura, sin nombrar comercio/necesidad propios (ej. "mañana entonces", "mejor espero", "capaz la semana que viene", "no es urgente, espero", "y mañana?", "¿y el jueves?"). false en cualquier otro caso.
- confirmsRecommendation y prefersToWait nunca son true al mismo tiempo, y nunca son true si el mensaje también trae merchantName, need o wantsGeneralSavings.
- asksLocation: true si el usuario pregunta explícitamente dónde queda o está un comercio (ej. "Chajá donde esta?", "¿dónde queda Ta-Ta?", "en qué dirección está Farmashop", "cómo llego a San Roque"). A diferencia de confirmsRecommendation/prefersToWait, ESTE campo SÍ puede ir junto con merchantName — de hecho normalmente lo hace, porque preguntan la ubicación DE un comercio puntual. false en cualquier otro caso.`;

const INTENT_JSON_SCHEMA = {
  name: 'parsed_intent',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      merchantName: { type: ['string', 'null'] },
      branchHint: { type: ['string', 'null'] },
      need: {
        type: ['string', 'null'],
        enum: [...USER_NEEDS, null],
      },
      items: { type: 'array', items: { type: 'string' } },
      zone: { type: ['string', 'null'] },
      city: { type: ['string', 'null'] },
      amount: { type: ['number', 'null'] },
      banks: {
        type: ['array', 'null'],
        items: { type: 'string', enum: [...MVP_BANK_NAMES] },
      },
      showAllBanks: { type: 'boolean' },
      wantsGeneralSavings: { type: 'boolean' },
      confirmsRecommendation: { type: 'boolean' },
      prefersToWait: { type: 'boolean' },
      asksLocation: { type: 'boolean' },
    },
    required: [
      'merchantName',
      'branchHint',
      'need',
      'items',
      'zone',
      'city',
      'amount',
      'banks',
      'showAllBanks',
      'wantsGeneralSavings',
      'confirmsRecommendation',
      'prefersToWait',
      'asksLocation',
    ],
    additionalProperties: false,
  },
};

interface OpenRouterChoice {
  message: { content: string };
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
  error?: { message: string };
}

@Injectable()
export class OpenRouterMessageInterpreter implements MessageInterpreter {
  private readonly logger = new Logger(OpenRouterMessageInterpreter.name);
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.model =
      configService.get<string>('OPENROUTER_MODEL') ?? 'openai/gpt-4o';
  }

  async interpret(message: string): Promise<ParsedIntent> {
    // getOrThrow acá adentro (no en el constructor): si falta la key, que
    // rompa recién cuando alguien intenta interpretar un mensaje, no que
    // tumbe el boot de toda la app (búsqueda/scrapers de Semana 2-3 tienen
    // que poder seguir andando sin que esté configurada la IA todavía).
    const apiKey = this.configService.getOrThrow<string>('OPENROUTER_API_KEY');

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'AhorroMVD',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: INTENT_JSON_SCHEMA,
        },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter respondió ${response.status}: ${body}`);
    }

    const data = (await response.json()) as OpenRouterResponse;
    if (data.error) {
      throw new Error(`OpenRouter error: ${data.error.message}`);
    }

    const content = data.choices[0]?.message.content;
    if (!content) {
      throw new Error('OpenRouter no devolvió contenido');
    }

    const raw = JSON.parse(content) as ParsedIntent;
    // `items` es lo único con lo que el resto del código itera sin chequear:
    // si el modelo devuelve null en vez de [], reventaría en el .join de la
    // respuesta. El schema lo pide array, pero no vale la pena confiar.
    const parsed: ParsedIntent = {
      ...raw,
      items: Array.isArray(raw.items) ? raw.items : [],
    };
    this.logger.debug(`"${message}" -> ${JSON.stringify(parsed)}`);
    return parsed;
  }
}

export const OPENROUTER_MESSAGE_INTERPRETER_PROVIDER = {
  provide: MESSAGE_INTERPRETER,
  useClass: OpenRouterMessageInterpreter,
};
