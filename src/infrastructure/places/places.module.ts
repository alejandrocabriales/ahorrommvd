import { Module } from '@nestjs/common';
import { SyncBranchesUseCase } from '../../application/branches/sync-branches.use-case';
import { GOOGLE_PLACES_BRANCH_DIRECTORY_PROVIDER } from './google-places-branch-directory.provider';

@Module({
  providers: [GOOGLE_PLACES_BRANCH_DIRECTORY_PROVIDER, SyncBranchesUseCase],
  exports: [SyncBranchesUseCase],
})
export class PlacesModule {}
