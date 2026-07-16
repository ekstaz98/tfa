import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  CodesCrudService,
  MethodsCrudService,
  OperationsCrudService,
  TypesCrudService,
  UsersCrudService,
} from '../database/crud';
import { Code, Operation, OperationStatus } from '../database/entities';
import { TwoFaError, TwoFaErrorCode } from '../errors';
import { VerifierRegistry } from './ports/verifier-registry';

export interface VerifyParams {
  operationId: string;
  method: string;
  /** core userId — гейтвей передаёт для authed-запросов. */
  userId?: string | null;
  codes: Array<{ type: string; code: string }>;
}

export interface VerifyResult {
  verified: boolean;
  /** Гейтвею для signin нужно знать, кто прошёл проверку. */
  userId: string | null;
  identity: string | null;
}

/**
 * Верификация кодов операции. Вся проверка — в транзакции с
 * SELECT ... FOR UPDATE; переходы статусов — условным UPDATE:
 * конкурентные verify не обходят лимит попыток и не верифицируют дважды.
 * Входящие коды не логируются.
 */
@Injectable()
export class VerificationService {
  private readonly attemptsLimit: number;

  constructor(
    config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly methodsCrud: MethodsCrudService,
    private readonly usersCrud: UsersCrudService,
    private readonly operationsCrud: OperationsCrudService,
    private readonly codesCrud: CodesCrudService,
    private readonly typesCrud: TypesCrudService,
    private readonly verifierRegistry: VerifierRegistry,
  ) {
    this.attemptsLimit = config.getOrThrow<number>('codes.attemptsLimit');
  }

  async verify(params: VerifyParams): Promise<VerifyResult> {
    const [method] = await this.methodsCrud.findBy({
      method: params.method,
      isDeleted: false,
    });

    return this.dataSource.transaction(async (manager) => {
      const operation = await this.operationsCrud.findByIdForUpdate(
        params.operationId,
        manager,
      );
      // привязка (method, для authed — userId) не совпала → неотличимо
      // от «операция не найдена»: существование чужих операций не палим
      if (!operation || !method || operation.methodId !== method.id) {
        throw new TwoFaError(TwoFaErrorCode.UnknownOperation);
      }
      if (params.userId) {
        const [user] = await this.usersCrud.findBy(
          { userId: params.userId },
          manager,
        );
        if (!user || operation.userId !== user.id) {
          throw new TwoFaError(TwoFaErrorCode.UnknownOperation);
        }
      }
      this.assertPending(operation);
      if (operation.expiresAt.getTime() <= Date.now()) {
        await this.operationsCrud.updateStatusIf(
          operation.id,
          OperationStatus.Pending,
          OperationStatus.Expired,
          manager,
        );
        throw new TwoFaError(TwoFaErrorCode.OperationExpired);
      }

      const rowByTypeName = await this.loadCodeRows(operation, manager);
      const provided = this.validateProvidedCodes(params.codes, rowByTypeName);

      const failures: Code[] = [];
      for (const [typeName, row] of rowByTypeName) {
        const verifier = this.verifierRegistry.get(typeName);
        const ok = await verifier.verify({
          code: provided.get(typeName) as string,
          codeRow: row,
          operation,
          typeName,
          manager,
        });
        if (!ok) {
          failures.push(row);
        }
      }

      if (failures.length > 0) {
        let exhausted = false;
        for (const row of failures) {
          const attempts = await this.codesCrud.incrementAttempts(
            row.id,
            manager,
          );
          if (attempts >= this.attemptsLimit) {
            exhausted = true;
          }
        }
        // исчерпание по ЛЮБОМУ типу валит операцию целиком — иначе
        // брутфорс одного канала при валидном втором
        if (exhausted) {
          await this.operationsCrud.updateStatusIf(
            operation.id,
            OperationStatus.Pending,
            OperationStatus.Failed,
            manager,
          );
          throw new TwoFaError(TwoFaErrorCode.AttemptsExceeded);
        }
        throw new TwoFaError(TwoFaErrorCode.WrongCode);
      }

      // операция одноразовая: конкурентный verify не пройдёт условный UPDATE
      const flipped = await this.operationsCrud.updateStatusIf(
        operation.id,
        OperationStatus.Pending,
        OperationStatus.Verified,
        manager,
      );
      if (!flipped) {
        throw new TwoFaError(TwoFaErrorCode.OperationAlreadyUsed);
      }
      const verifiedAt = new Date();
      for (const row of rowByTypeName.values()) {
        await this.codesCrud.update(row.id, { verifiedAt }, manager);
      }

      const user = operation.userId
        ? await this.usersCrud.findById(operation.userId, manager)
        : null;
      return {
        verified: true,
        userId: user?.userId ?? null,
        identity: operation.identity,
      };
    });
  }

  private assertPending(operation: Operation): void {
    switch (operation.status) {
      case OperationStatus.Pending:
        return;
      case OperationStatus.Verified:
        throw new TwoFaError(TwoFaErrorCode.OperationAlreadyUsed);
      case OperationStatus.Failed:
        throw new TwoFaError(TwoFaErrorCode.AttemptsExceeded);
      case OperationStatus.Expired:
        throw new TwoFaError(TwoFaErrorCode.OperationExpired);
    }
  }

  private async loadCodeRows(
    operation: Operation,
    manager: EntityManager,
  ): Promise<Map<string, Code>> {
    const [rows, types] = await Promise.all([
      this.codesCrud.findBy({ operationId: operation.id }, manager),
      this.typesCrud.findBy({}, manager),
    ]);
    const typeNameById = new Map(types.map((type) => [type.id, type.type]));
    return new Map(
      rows.map((row) => [typeNameById.get(row.typeId) as string, row]),
    );
  }

  /**
   * Строгая валидация codes[]: дубль типа, тип не из операции или
   * неполное покрытие типов → отказ БЕЗ инкремента попыток.
   */
  private validateProvidedCodes(
    codes: Array<{ type: string; code: string }>,
    rowByTypeName: Map<string, Code>,
  ): Map<string, string> {
    const provided = new Map<string, string>();
    for (const { type, code } of codes) {
      if (provided.has(type)) {
        throw new TwoFaError(
          TwoFaErrorCode.WrongCode,
          `Duplicate code for type "${type}"`,
        );
      }
      provided.set(type, code);
    }
    for (const typeName of provided.keys()) {
      if (!rowByTypeName.has(typeName)) {
        throw new TwoFaError(
          TwoFaErrorCode.WrongCode,
          `Type "${typeName}" is not a part of the operation`,
        );
      }
    }
    for (const typeName of rowByTypeName.keys()) {
      if (!provided.has(typeName)) {
        throw new TwoFaError(
          TwoFaErrorCode.WrongCode,
          'Codes for all operation types must be provided',
        );
      }
    }
    return provided;
  }
}
