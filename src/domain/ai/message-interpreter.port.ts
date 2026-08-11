import { ParsedIntent } from './parsed-intent';

export interface MessageInterpreter {
  interpret(message: string): Promise<ParsedIntent>;
}

export const MESSAGE_INTERPRETER = Symbol('MESSAGE_INTERPRETER');
