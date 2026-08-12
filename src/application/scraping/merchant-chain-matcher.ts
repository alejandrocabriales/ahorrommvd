import { MerchantChain } from '../../../generated/prisma/client';
import { normalizeMerchantName } from '../../domain/scraping/normalize-merchant-name';

/** Matchea por nombre normalizado (sin acentos/guiones/espacios): "TaTa" === "Ta-Ta". */
export function matchMerchantChain(
  chains: MerchantChain[],
  scrapedName: string,
): MerchantChain | undefined {
  const target = normalizeMerchantName(scrapedName);
  return chains.find((chain) => normalizeMerchantName(chain.name) === target);
}
