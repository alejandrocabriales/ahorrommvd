import { resolveChainBranches } from './resolve-chain-branches';

const CHAIN = { id: 'chain-tata', name: 'Ta-Ta' };
const POCITOS = {
  branchId: 'b-pocitos',
  branchName: 'Ta-Ta Pocitos',
  neighborhood: 'Pocitos',
};
const CERRO = {
  branchId: 'b-cerro',
  branchName: 'Ta-Ta Hiper Cerro',
  neighborhood: 'Cerro',
};

describe('resolveChainBranches', () => {
  it('resolves at chain level when there are no branches (most auto-discovered merchants)', () => {
    const result = resolveChainBranches(CHAIN, []);

    expect(result).toEqual({
      status: 'resolved',
      merchantChainId: 'chain-tata',
      merchantChainName: 'Ta-Ta',
    });
  });

  it('resolves directly to the only branch without asking', () => {
    const result = resolveChainBranches(CHAIN, [POCITOS]);

    expect(result).toEqual({
      status: 'resolved',
      merchantChainId: 'chain-tata',
      merchantChainName: 'Ta-Ta',
      branchId: 'b-pocitos',
      branchName: 'Ta-Ta Pocitos',
    });
  });

  it('uses the user preferred branch when there are multiple branches', () => {
    const result = resolveChainBranches(CHAIN, [POCITOS, CERRO], 'b-cerro');

    expect(result).toMatchObject({ status: 'resolved', branchId: 'b-cerro' });
  });

  it('asks which branch when there are multiple and no preference matches', () => {
    const result = resolveChainBranches(CHAIN, [POCITOS, CERRO]);

    expect(result).toEqual({
      status: 'disambiguate',
      merchantChainId: 'chain-tata',
      merchantChainName: 'Ta-Ta',
      options: [POCITOS, CERRO],
    });
  });

  it('asks when the preferred branch belongs to a different chain', () => {
    const result = resolveChainBranches(
      CHAIN,
      [POCITOS, CERRO],
      'some-other-chain-branch',
    );

    expect(result.status).toBe('disambiguate');
  });
});
