import { MerchantChain } from '../../../generated/prisma/client';

function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Matchea por nombre normalizado (sin acentos/guiones/espacios): "TaTa" === "Ta-Ta". */
export function matchMerchantChain(
  chains: MerchantChain[],
  scrapedName: string,
): MerchantChain | undefined {
  const target = normalize(scrapedName);
  return chains.find((chain) => normalize(chain.name) === target);
}
