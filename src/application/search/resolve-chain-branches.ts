import {
  BranchOption,
  MerchantResolution,
} from '../../domain/search/branch-resolution';

/**
 * Comportamiento esperado por el spec para "Ta-Ta": 0 sucursales -> la
 * cadena entera (es lo único que hay); 1 sucursal -> esa, sin preguntar;
 * 2+ sucursales -> usar la preferida del usuario si existe, si no preguntar
 * ("¿En cuál Ta-Ta? Pocitos / Punta Carretas / ..."). Función pura para
 * poder testear la lógica de decisión sin tocar la base.
 */
export function resolveChainBranches(
  chain: { id: string; name: string },
  branches: BranchOption[],
  preferredBranchId?: string | null,
): MerchantResolution {
  if (branches.length === 0) {
    return {
      status: 'resolved',
      merchantChainId: chain.id,
      merchantChainName: chain.name,
    };
  }

  if (branches.length === 1) {
    const [only] = branches;
    return {
      status: 'resolved',
      merchantChainId: chain.id,
      merchantChainName: chain.name,
      branchId: only.branchId,
      branchName: only.branchName,
    };
  }

  const preferred = preferredBranchId
    ? branches.find((b) => b.branchId === preferredBranchId)
    : undefined;
  if (preferred) {
    return {
      status: 'resolved',
      merchantChainId: chain.id,
      merchantChainName: chain.name,
      branchId: preferred.branchId,
      branchName: preferred.branchName,
    };
  }

  return {
    status: 'disambiguate',
    merchantChainId: chain.id,
    merchantChainName: chain.name,
    options: branches,
  };
}
