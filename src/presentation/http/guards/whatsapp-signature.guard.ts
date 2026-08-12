import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { verifyMetaSignature } from '../../../infrastructure/whatsapp/verify-meta-signature';

type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * Solo va en el POST del webhook (el GET de verificación de Meta no manda
 * firma, es un handshake distinto). Falla cerrado a propósito: si falta
 * `WHATSAPP_APP_SECRET` o el `rawBody`, rechaza en vez de dejar pasar sin
 * validar — un webhook "seguro pero mal configurado" que en realidad no
 * valida nada es peor que uno que da 401 hasta que se configure bien.
 */
@Injectable()
export class WhatsAppSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WhatsAppSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithRawBody>();

    const appSecret = this.configService.get<string>('WHATSAPP_APP_SECRET');
    if (!appSecret) {
      this.logger.error(
        'WHATSAPP_APP_SECRET no configurado — rechazando el webhook por seguridad en vez de procesar sin validar.',
      );
      throw new UnauthorizedException();
    }

    if (!request.rawBody) {
      this.logger.error(
        'No hay rawBody en el request — falta { rawBody: true } en NestFactory.create.',
      );
      throw new UnauthorizedException();
    }

    const signatureHeader = request.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;

    if (!verifyMetaSignature(request.rawBody, signature, appSecret)) {
      this.logger.warn(
        'Firma de webhook inválida — posible pedido falsificado, rechazado.',
      );
      throw new UnauthorizedException();
    }

    return true;
  }
}
