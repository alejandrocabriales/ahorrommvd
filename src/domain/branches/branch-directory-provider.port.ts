import { MvpCategoryName } from '../scraping/mvp-category';
import { BranchCandidate } from './branch-candidate';

export interface BranchDirectoryProvider {
  /**
   * Busca sucursales reales de una cadena en Montevideo. `categoryName` se
   * usa para descartar resultados que no son del rubro esperado (ver
   * `CATEGORY_PLACE_TYPES`). [] si no encuentra nada — nunca inventa una
   * dirección.
   */
  findBranches(
    chainName: string,
    categoryName: MvpCategoryName,
  ): Promise<BranchCandidate[]>;
}

export const BRANCH_DIRECTORY_PROVIDER = Symbol('BRANCH_DIRECTORY_PROVIDER');
