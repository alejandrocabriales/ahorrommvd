export interface BranchOption {
  branchId: string;
  branchName: string;
  neighborhood: string | null;
}

export type MerchantResolution =
  | {
      status: 'resolved';
      merchantChainId: string;
      merchantChainName: string;
      branchId?: string;
      branchName?: string;
    }
  | {
      status: 'disambiguate';
      merchantChainId: string;
      merchantChainName: string;
      options: BranchOption[];
    }
  | { status: 'not_found' };
