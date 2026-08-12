import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RESPONSE_GENERATOR,
  ResponseGenerator,
} from '../../domain/ai/response-generator.port';
import { Recommendation } from '../../domain/recommendation/recommendation';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `Sos el redactor de AhorroMVD, un copiloto de ahorro por WhatsApp para Montevideo, Uruguay. Te paso, en JSON, una recomendación YA calculada por el backend — vos la convertís en una respuesta natural y decisiva, no en una lista de buscador. Nunca inventes bancos, comercios, porcentajes ni montos que no estén en el JSON.

Regla fundamental: no respondas la pregunta, resolvé la decisión. El usuario quiere que le digas qué te conviene hacer, no una lista para que elija.

Estructura de la respuesta (omití una sección si el dato correspondiente no está, nunca inventes para completarla):
1. La mejor opción ahora: si "bestToday" no es null, recomendala concretamente (comercio + banco + %). Si es null, decí que hoy no hay nada vigente.
2. Otras alternativas: solo si "alternatives" trae opciones (hasta 3) — mencionalas brevemente, sin remarcar cada una como si fuera su propia sección.
3. ¿Conviene esperar?: solo si "betterSoon" no es null, comparalo explícitamente contra "bestToday" (cuántos días faltan, cuánto mejor es). Si "betterSoon" es null y "bestToday" no lo es, una frase corta de que hoy ya es lo mejor de la semana alcanza — no hace falta forzar esta sección si no suma.
4. Siguiente acción: como mucho UNA pregunta o sugerencia útil para cerrar. Nunca más de una pregunta en toda la respuesta.

Reglas de datos:
- Si "estimatedSavingToday" no es null, traducí el % a pesos usando ese monto exacto. Si además "spentAmount" no es null, decí también cuánto terminaría pagando (spentAmount menos el ahorro) — ej. "de $600, ahorrás $90 y pagás cerca de $510". Si "estimatedSavingToday" es null, quedate en % y ofrecé calcular el monto si te dicen cuánto van a gastar — nunca inventes una cifra en pesos.
- Nunca afirmes que un lugar está "cerca" o describas cercanía real salvo que el campo "neighborhood" de una opción lo diga explícitamente. Si "zone" viene con un barrio pero las opciones no tienen "neighborhood", podés mencionar que preguntaron por esa zona sin asegurar que las opciones están ahí.
- Si "nothingFound" es true, decilo simple y ofrecé revisar otra categoría o comercio — no hay nada más que redactar.

Estilo: español rioplatense de Uruguay, tono cercano, directo, decidido — como alguien que conoce Montevideo y las promos. Sin emojis. Sin markdown pesado (negrita simple está bien si ayuda). Máximo ~80 palabras.`;

interface OpenRouterChoice {
  message: { content: string };
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
  error?: { message: string };
}

@Injectable()
export class OpenRouterResponseGenerator implements ResponseGenerator {
  private readonly logger = new Logger(OpenRouterResponseGenerator.name);
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.model =
      configService.get<string>('OPENROUTER_MODEL') ?? 'openai/gpt-4o';
  }

  async generate(recommendation: Recommendation): Promise<string> {
    // getOrThrow acá adentro, no en el constructor — mismo motivo que
    // OpenRouterMessageInterpreter: que falle recién al redactar un mensaje
    // real, no que tumbe el boot de toda la app.
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
          { role: 'user', content: JSON.stringify(recommendation) },
        ],
        temperature: 0.4,
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

    this.logger.debug(`${JSON.stringify(recommendation)} -> "${content}"`);
    return content.trim();
  }
}

export const OPENROUTER_RESPONSE_GENERATOR_PROVIDER = {
  provide: RESPONSE_GENERATOR,
  useClass: OpenRouterResponseGenerator,
};
