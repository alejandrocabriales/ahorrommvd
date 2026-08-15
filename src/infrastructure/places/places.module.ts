import { Module } from '@nestjs/common';
import { SyncBranchesUseCase } from '../../application/branches/sync-branches.use-case';
import { GOOGLE_PLACES_BRANCH_DIRECTORY_PROVIDER } from './google-places-branch-directory.provider';
import { GooglePlacesZoneGeocoder } from './google-places-zone-geocoder';
import { MONTEVIDEO_ZONE_GEOCODER } from './montevideo-zone.geocoder';

// ZONE_GEOCODER resuelve a MontevideoZoneGeocoder, que usa la tabla fija de
// barrios y deja a GooglePlacesZoneGeocoder (registrado como clase, no como
// token) para lo que la tabla no cubre.
@Module({
  providers: [
    GOOGLE_PLACES_BRANCH_DIRECTORY_PROVIDER,
    GooglePlacesZoneGeocoder,
    MONTEVIDEO_ZONE_GEOCODER,
    SyncBranchesUseCase,
  ],
  exports: [SyncBranchesUseCase, MONTEVIDEO_ZONE_GEOCODER],
})
export class PlacesModule {}
