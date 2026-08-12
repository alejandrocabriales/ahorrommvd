import { Module } from '@nestjs/common';
import { MESSAGE_INTERPRETER } from '../../domain/ai/message-interpreter.port';
import { RESPONSE_GENERATOR } from '../../domain/ai/response-generator.port';
import { OPENROUTER_MESSAGE_INTERPRETER_PROVIDER } from './openrouter-message-interpreter.service';
import { OPENROUTER_RESPONSE_GENERATOR_PROVIDER } from './openrouter-response-generator.service';

@Module({
  providers: [
    OPENROUTER_MESSAGE_INTERPRETER_PROVIDER,
    OPENROUTER_RESPONSE_GENERATOR_PROVIDER,
  ],
  exports: [MESSAGE_INTERPRETER, RESPONSE_GENERATOR],
})
export class AiModule {}
