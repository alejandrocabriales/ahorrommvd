import { BranchCandidate } from '../../domain/branches/branch-candidate';
import { BranchDirectoryProvider } from '../../domain/branches/branch-directory-provider.port';
import { SyncBranchesUseCase } from './sync-branches.use-case';

const CHAINS_WITHOUT_BRANCHES = [
  { id: 'chain-tata', name: 'Ta-Ta', category: { name: 'Supermercados' } },
  { id: 'chain-chaja', name: 'Chajá', category: { name: 'Restaurantes' } },
];

function candidate(overrides: Partial<BranchCandidate>): BranchCandidate {
  return {
    name: 'Ta-Ta',
    address: 'Av. Brasil 2846, Montevideo',
    neighborhood: 'Pocitos',
    latitude: -34.9,
    longitude: -56.16,
    ...overrides,
  };
}

function fakeProvider(
  byChain: Record<string, BranchCandidate[] | Error>,
): BranchDirectoryProvider {
  return {
    findBranches: (chainName: string) => {
      const result = byChain[chainName] ?? [];
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    },
  };
}

function buildPrismaMock() {
  const createdBatches: Array<{ chainId: string; names: string[] }> = [];
  return {
    createdBatches,
    merchantChain: {
      findMany: jest.fn().mockResolvedValue(CHAINS_WITHOUT_BRANCHES),
    },
    branch: {
      createMany: jest
        .fn()
        .mockImplementation(
          ({
            data,
          }: {
            data: Array<{ merchantChainId: string; name: string }>;
          }) => {
            createdBatches.push({
              chainId: data[0]?.merchantChainId,
              names: data.map((d) => d.name),
            });
            return Promise.resolve({ count: data.length });
          },
        ),
    },
  };
}

describe('SyncBranchesUseCase', () => {
  it('only queries chains with zero branches, and saves what the provider finds', async () => {
    const prisma = buildPrismaMock();
    const provider = fakeProvider({
      'Ta-Ta': [
        candidate({ name: 'Ta-Ta Pocitos', neighborhood: 'Pocitos' }),
        candidate({ name: 'Ta-Ta Cerro', neighborhood: 'Cerro' }),
      ],
      Chajá: [],
    });
    const useCase = new SyncBranchesUseCase(prisma as never, provider);

    const results = await useCase.execute();

    expect(prisma.merchantChain.findMany).toHaveBeenCalledWith({
      where: { branches: { none: {} } },
      include: { category: true },
    });
    expect(results).toEqual([
      { chainName: 'Ta-Ta', found: 2, saved: 2 },
      { chainName: 'Chajá', found: 0, saved: 0 },
    ]);
    expect(prisma.createdBatches).toEqual([
      { chainId: 'chain-tata', names: ['Ta-Ta Pocitos', 'Ta-Ta Cerro'] },
    ]);
  });

  it('disambiguates repeated names from the same chain before saving (unique constraint is chain+name)', async () => {
    const prisma = buildPrismaMock();
    const provider = fakeProvider({
      'Ta-Ta': [
        candidate({ name: 'Ta-Ta', neighborhood: 'Pocitos' }),
        candidate({ name: 'Ta-Ta', neighborhood: 'Cerro' }),
      ],
      Chajá: [],
    });
    const useCase = new SyncBranchesUseCase(prisma as never, provider);

    await useCase.execute();

    expect(prisma.createdBatches[0].names).toEqual([
      'Ta-Ta',
      'Ta-Ta (Cerro)',
    ]);
  });

  it('records the error for a chain whose Places lookup fails, without breaking the rest', async () => {
    const prisma = buildPrismaMock();
    const provider = fakeProvider({
      'Ta-Ta': new Error('Places API respondió 500: boom'),
      Chajá: [candidate({ name: 'Chajá Pocitos' })],
    });
    const useCase = new SyncBranchesUseCase(prisma as never, provider);

    const results = await useCase.execute();

    expect(results[0]).toEqual({
      chainName: 'Ta-Ta',
      found: 0,
      saved: 0,
      error: 'Places API respondió 500: boom',
    });
    expect(results[1]).toEqual({ chainName: 'Chajá', found: 1, saved: 1 });
  });
});
