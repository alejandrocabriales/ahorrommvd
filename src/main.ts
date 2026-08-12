import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true expone request.rawBody (Buffer) además del body parseado —
  // WhatsAppSignatureGuard lo necesita porque la firma HMAC de Meta se
  // calcula sobre los bytes exactos que mandaron, no sobre el JSON ya
  // parseado (reserializarlo podría no coincidir byte a byte).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
