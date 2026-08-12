import { Module } from '@nestjs/common';
import { ResolveUserUseCase } from './resolve-user.use-case';
import { SetUserBanksUseCase } from './set-user-banks.use-case';

@Module({
  providers: [ResolveUserUseCase, SetUserBanksUseCase],
  exports: [ResolveUserUseCase, SetUserBanksUseCase],
})
export class UsersModule {}
