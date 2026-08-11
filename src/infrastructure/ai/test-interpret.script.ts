/**
 * Runner manual para probar la interpretación de mensajes contra OpenRouter
 * de verdad, sin levantar toda la app. Uso: npm run ai:test
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { OpenRouterMessageInterpreter } from './openrouter-message-interpreter.service';

const MESSAGES = [
  'Ta-Ta Pocitos',
  'Voy al súper',
  'Necesito una farmacia',
  'Voy a Punta Carretas',
  'tata 4000',
  'Quiero comer algo rico',
];

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

  for (const message of MESSAGES) {
    const intent = await interpreter.interpret(message);
    console.log(`"${message}" ->`, JSON.stringify(intent));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
