import { Module } from '@nestjs/common';
import { MESSAGE_INTERPRETER } from '../../domain/ai/message-interpreter.port';
import { OPENROUTER_MESSAGE_INTERPRETER_PROVIDER } from './openrouter-message-interpreter.service';

@Module({
  providers: [OPENROUTER_MESSAGE_INTERPRETER_PROVIDER],
  exports: [MESSAGE_INTERPRETER],
})
export class AiModule {}
