import { BranchCandidate } from './branch-candidate';

export interface BranchDirectoryProvider {
  /** Busca sucursales reales de una cadena en Montevideo. [] si no encuentra nada — nunca inventa una dirección. */
  findBranches(chainName: string): Promise<BranchCandidate[]>;
}

export const BRANCH_DIRECTORY_PROVIDER = Symbol('BRANCH_DIRECTORY_PROVIDER');
