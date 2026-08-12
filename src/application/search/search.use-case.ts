import { Injectable } from '@nestjs/common';
import { SearchResponse } from '../../domain/search/search-response';
import { GetPromotionComparisonUseCase } from './get-promotion-comparison.use-case';
import { ResolveMerchantUseCase } from './resolve-merchant.use-case';
import { buildSearchMessage, computeEstimatedSaving } from './search-message';

export interface SearchInput {
  q?: string;
  merchantChainId?: string;
  branchId?: string;
  userId?: string;
  amount?: number;
}

/**
 * Orquestador de GET /search: resuelve el comercio/sucursal (con
 * ResolveMerchantUseCase), calcula la comparación hoy-vs-7-días
 * (GetPromotionComparisonUseCase) y arma la respuesta. Es el motor
 * "independiente del canal WhatsApp" que pide el spec — Semana 4 solo va a
 * tener que traducir lenguaje natural a este mismo input (q/amount) y
 * mandar `message` (o su propia redacción con IA) al usuario.
 */
@Injectable()
export class SearchUseCase {
  constructor(
    private readonly resolveMerchant: ResolveMerchantUseCase,
    private readonly getComparison: GetPromotionComparisonUseCase,
  ) {}

  async execute(input: SearchInput): Promise<SearchResponse> {
    const resolution = await this.resolveMerchant.execute({
      q: input.q,
      merchantChainId: input.merchantChainId,
      branchId: input.branchId,
      userId: input.userId,
    });

    if (resolution.status === 'not_found') {
      return { status: 'not_found' };
    }

    if (resolution.status === 'disambiguate') {
      return {
        status: 'disambiguate',
        merchantChainName: resolution.merchantChainName,
        options: resolution.options,
      };
    }

    const comparison = await this.getComparison.execute(
      resolution.merchantChainId,
      resolution.branchId,
      input.userId,
    );
    const estimatedSaving = computeEstimatedSaving(
      comparison.today,
      input.amount,
    );
    const message = buildSearchMessage({
      merchantChainName: resolution.merchantChainName,
      branchName: resolution.branchName,
      comparison,
      estimatedSaving,
    });

    return {
      status: 'resolved',
      merchantChainName: resolution.merchantChainName,
      branchId: resolution.branchId,
      branchName: resolution.branchName,
      neighborhood: resolution.neighborhood,
      address: resolution.address,
      estimatedSaving,
      message,
      ...comparison,
    };
  }
}
