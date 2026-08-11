import { BranchOption } from './branch-resolution';
import { PromotionComparison } from './search-result';

export interface EstimatedSaving {
  amount: number;
  discountPercentage: number;
  cappedByBank: boolean;
}

export type SearchResponse =
  | { status: 'not_found' }
  | {
      status: 'disambiguate';
      merchantChainName: string;
      options: BranchOption[];
    }
  | ({
      status: 'resolved';
      merchantChainName: string;
      branchId?: string;
      branchName?: string;
      estimatedSaving?: EstimatedSaving | null;
      message: string;
    } & PromotionComparison);
