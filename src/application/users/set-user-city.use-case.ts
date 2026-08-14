import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { normalizeMerchantName } from '../../domain/scraping/normalize-merchant-name';

export interface SetUserCityResult {
  userId: string;
  city: string;
}

/**
 * Guarda la ciudad/departamento que el usuario dijo que es su ubicación —
 * mismo patrón que SetUserBanksUseCase: se llama apenas se detecta en el
 * mensaje, no depende de que haya una Recommendation real (a diferencia de
 * knownZone, que sí se guarda junto con conversationContext). Si dice
 * "Montevideo" explícitamente no guarda nada — ese es el default, no hace
 * falta una fila extra para representarlo.
 */
@Injectable()
export class SetUserCityUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    whatsapp: string,
    city: string,
  ): Promise<SetUserCityResult | null> {
    if (normalizeMerchantName(city) === normalizeMerchantName('Montevideo')) {
      return null;
    }

    const user = await this.prisma.user.upsert({
      where: { whatsapp },
      update: { knownCity: city },
      create: { whatsapp, knownCity: city },
    });

    return { userId: user.id, city };
  }
}
