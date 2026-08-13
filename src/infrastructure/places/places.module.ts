import { Module } from '@nestjs/common';
import { SyncBranchesUseCase } from '../../application/branches/sync-branches.use-case';
import { GOOGLE_PLACES_BRANCH_DIRECTORY_PROVIDER } from './google-places-branch-directory.provider';
import { GOOGLE_PLACES_ZONE_GEOCODER } from './google-places-zone-geocoder';

@Module({
  providers: [
    GOOGLE_PLACES_BRANCH_DIRECTORY_PROVIDER,
    GOOGLE_PLACES_ZONE_GEOCODER,
    SyncBranchesUseCase,
  ],
  exports: [SyncBranchesUseCase, GOOGLE_PLACES_ZONE_GEOCODER],
})
export class PlacesModule {}
