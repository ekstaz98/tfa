import { EntityManager } from 'typeorm';
import { Code, Operation } from '../../database/entities';

export interface CodeVerifyContext {
  code: string;
  codeRow: Code;
  operation: Operation;
  typeName: string;
  manager: EntityManager;
}

/** Порт верификации кода: реализации по типам взаимозаменяемы (LSP). */
export interface CodeVerifierPort {
  verify(context: CodeVerifyContext): Promise<boolean>;
}
