import { Module } from '@nestjs/common';
import { ResolveUserUseCase } from './resolve-user.use-case';
import { SetUserBanksUseCase } from './set-user-banks.use-case';
import { SavePendingQueryUseCase } from './save-pending-query.use-case';
import { ClearPendingQueryUseCase } from './clear-pending-query.use-case';
import { SaveConversationContextUseCase } from './save-conversation-context.use-case';

@Module({
  providers: [
    ResolveUserUseCase,
    SetUserBanksUseCase,
    SavePendingQueryUseCase,
    ClearPendingQueryUseCase,
    SaveConversationContextUseCase,
  ],
  exports: [
    ResolveUserUseCase,
    SetUserBanksUseCase,
    SavePendingQueryUseCase,
    ClearPendingQueryUseCase,
    SaveConversationContextUseCase,
  ],
})
export class UsersModule {}
