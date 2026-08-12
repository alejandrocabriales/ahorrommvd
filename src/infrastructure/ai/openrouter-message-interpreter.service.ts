import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MESSAGE_INTERPRETER,
  MessageInterpreter,
} from '../../domain/ai/message-interpreter.port';
import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { MVP_BANK_NAMES } from '../../domain/scraping/bank-name';
import { MVP_CATEGORY_NAMES } from '../../domain/scraping/mvp-category';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `Extraés la intención de un mensaje de WhatsApp de un usuario en Montevideo, Uruguay, que busca dónde y con qué tarjeta comprar más barato.

Reglas:
- Nunca inventes un comercio, sucursal, monto o banco que el usuario no haya escrito. Si algo no está en el mensaje, ese campo va null.
- merchantName: nombre de cadena/comercio tal cual lo escribió el usuario, con errores de tipeo incluidos (ej. "tata", "farmashop"). null si no menciona ninguno.
- branchHint: sucursal o barrio puntual mencionado junto al comercio (ej. "Ta-Ta Pocitos" -> "Pocitos"). null si no aplica.
- categoryName: SOLO si el usuario no nombra un comercio puntual, uno de "${MVP_CATEGORY_NAMES.join('", "')}". Ej. "voy al súper" -> Supermercados, "necesito una farmacia" -> Farmacias, "quiero comer algo" -> Restaurantes. null si no aplica o si ya hay merchantName.
- zone: barrio de Montevideo mencionado sin comercio específico (ej. "voy a Punta Carretas"). null si no aplica.
- amount: monto en pesos uruguayos si el usuario dice cuánto gastó o va a gastar (ej. "Ta-Ta 4000" -> 4000). null si no menciona monto.
- banks: lista de bancos con los que el usuario dice tener tarjeta, SOLO de "${MVP_BANK_NAMES.join('", "')}" (ej. "tengo Itaú y Santander" -> ["Itaú","Santander"], "mi tarjeta es OCA" -> ["OCA"]). Si menciona un banco que no es ninguno de esos tres, ignoralo. null si no menciona ningún banco en este mensaje.
- showAllBanks: true SOLO si el usuario pide explícitamente ver ofertas de todos los bancos, no solo los suyos (ej. "dame todas las ofertas", "mostrame todo", "todas las promos", "de todos los bancos"). false en cualquier otro caso, incluso si no lo menciona.
- wantsGeneralSavings: true si el usuario pide ahorrar o la mejor opción en general SIN nombrar comercio ni categoría (ej. "quiero ahorrar hoy", "qué me conviene hacer", "qué descuento hay hoy", "dame la mejor oferta"). false si ya hay merchantName o categoryName, o si el mensaje no tiene que ver con ahorrar.`;

const INTENT_JSON_SCHEMA = {
  name: 'parsed_intent',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      merchantName: { type: ['string', 'null'] },
      branchHint: { type: ['string', 'null'] },
      categoryName: {
        type: ['string', 'null'],
        enum: [...MVP_CATEGORY_NAMES, null],
      },
      zone: { type: ['string', 'null'] },
      amount: { type: ['number', 'null'] },
      banks: {
        type: ['array', 'null'],
        items: { type: 'string', enum: [...MVP_BANK_NAMES] },
      },
      showAllBanks: { type: 'boolean' },
      wantsGeneralSavings: { type: 'boolean' },
    },
    required: [
      'merchantName',
      'branchHint',
      'categoryName',
      'zone',
      'amount',
      'banks',
      'showAllBanks',
      'wantsGeneralSavings',
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

    const parsed = JSON.parse(content) as ParsedIntent;
    this.logger.debug(`"${message}" -> ${JSON.stringify(parsed)}`);
    return parsed;
  }
}

export const OPENROUTER_MESSAGE_INTERPRETER_PROVIDER = {
  provide: MESSAGE_INTERPRETER,
  useClass: OpenRouterMessageInterpreter,
};
