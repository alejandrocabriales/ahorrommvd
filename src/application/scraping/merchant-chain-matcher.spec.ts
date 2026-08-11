import { MerchantChain } from '../../../generated/prisma/client';
import { matchMerchantChain } from './merchant-chain-matcher';

function chain(name: string): MerchantChain {
  return { id: name, name, categoryId: 'cat-1' };
}

describe('matchMerchantChain', () => {
  const chains = [chain('Ta-Ta'), chain('Farmashop'), chain("McDonald's")];

  it('matches regardless of hyphens/spacing ("TaTa" scraped vs "Ta-Ta" seeded)', () => {
    expect(matchMerchantChain(chains, 'TaTa')?.name).toBe('Ta-Ta');
  });

  it('matches regardless of case', () => {
    expect(matchMerchantChain(chains, 'farmashop')?.name).toBe('Farmashop');
  });

  it('matches regardless of apostrophes', () => {
    expect(matchMerchantChain(chains, 'Mcdonalds')?.name).toBe("McDonald's");
  });

  it('returns undefined for a merchant not in our catalog', () => {
    expect(matchMerchantChain(chains, 'Disco')).toBeUndefined();
  });
});
