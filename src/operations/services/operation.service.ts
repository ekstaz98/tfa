import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, MoreThanOrEqual } from 'typeorm';
import {
  CodesCrudService,
  MethodTagsCrudService,
  MethodTypesCrudService,
  MethodsCrudService,
  OperationsCrudService,
  TagsCrudService,
  TypesCrudService,
  UserCredentialsCrudService,
  UsersCrudService,
} from '../../database/crud';
import {
  Code,
  Method,
  Operation,
  OperationStatus,
  User,
} from '../../database/entities';
import { TwoFaError, TwoFaErrorCode } from '../../errors';
import { TAG_SYSTEM, TAG_UNAUTHED } from '../../methods/constants';
import { EffectiveMethodsResolverService } from '../../methods/services';
import { CodeGeneratorService } from './code-generator.service';
import {
  IdentityMaskerService,
  IdentityNormalizerService,
} from './identity.service';
import {
  CODE_SEND_PUBLISHER,
  CodeSendEvent,
  CodeSendPublisherPort,
  SendTwoFaParams,
  SendTwoFaResult,
  SendTwoFaTypeView,
  SendActor,
} from '../interfaces';
import { VerifierRegistry } from './verifier-registry';

interface ActorContext {
  authed: boolean;
  user: User | null;
  /** Нормализованный identity unauthed-актора. */
  identity: string | null;
  clientIp: string | null;
}

interface PreparedType {
  typeName: string;
  typeId: string;
  /** Куда слать; null — не отправляемый (GA) или пустышка. */
  destination: string | null;
  /** Маскированный identity для ответа (для GA — null). */
  maskedIdentity: string | null;
  selfVerified: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** sendTwoFa: создание операции, генерация и публикация кодов, переотправка. */
@Injectable()
export class OperationService {
  private readonly _logger = new Logger(OperationService.name);
  private readonly _ttlSeconds: number;
  private readonly _retrySeconds: number;
  private readonly _resendsLimit: number;
  private readonly _operationsPerDay: number;
  private readonly _ipHourlyLimit: number;
  private readonly _eventName: string;
  private readonly _providerByType: Record<string, string>;

  constructor(
    config: ConfigService,
    private readonly _dataSource: DataSource,
    private readonly _methodsCrud: MethodsCrudService,
    private readonly _methodTypesCrud: MethodTypesCrudService,
    private readonly _methodTagsCrud: MethodTagsCrudService,
    private readonly _tagsCrud: TagsCrudService,
    private readonly _typesCrud: TypesCrudService,
    private readonly _usersCrud: UsersCrudService,
    private readonly _credentialsCrud: UserCredentialsCrudService,
    private readonly _operationsCrud: OperationsCrudService,
    private readonly _codesCrud: CodesCrudService,
    private readonly _effectiveMethods: EffectiveMethodsResolverService,
    private readonly _codeGenerator: CodeGeneratorService,
    private readonly _normalizer: IdentityNormalizerService,
    private readonly _masker: IdentityMaskerService,
    private readonly _verifierRegistry: VerifierRegistry,
    @Inject(CODE_SEND_PUBLISHER)
    private readonly _publisher: CodeSendPublisherPort,
  ) {
    this._ttlSeconds = config.getOrThrow<number>('codes.ttlSeconds');
    this._retrySeconds = config.getOrThrow<number>('codes.retrySeconds');
    this._resendsLimit = config.getOrThrow<number>('codes.resendsLimit');
    this._operationsPerDay = config.getOrThrow<number>(
      'limits.operationsPerDay',
    );
    this._ipHourlyLimit = config.getOrThrow<number>(
      'limits.unauthedOpsPerHourPerIp',
    );
    this._eventName = config.getOrThrow<string>('sendEvent.name');
    this._providerByType = config.getOrThrow<Record<string, string>>(
      'sendEvent.providerByType',
    );
  }

  async sendTwoFa(params: SendTwoFaParams): Promise<SendTwoFaResult> {
    const { method, tagNames } = await this._loadMethod(params.method);
    const actor = await this._resolveActor(params.actor, tagNames);
    if (params.operationId) {
      return this._resend(params, method, tagNames, actor);
    }
    return this._createOperation(params, method, tagNames, actor);
  }

  // ---------- создание операции ----------

  private async _createOperation(
    params: SendTwoFaParams,
    method: Method,
    tagNames: string[],
    actor: ActorContext,
  ): Promise<SendTwoFaResult> {
    const isRegistration =
      tagNames.includes(TAG_SYSTEM) && tagNames.includes(TAG_UNAUTHED);
    const coreUserId = actor.authed
      ? (params.actor.userId as string)
      : (actor.user?.userId ?? null);

    const effective = await this._effectiveMethods.resolve(coreUserId);
    const effectiveTypes =
      effective.find((view) => view.id === method.id)?.types ?? [];

    // непокрытый метод: authed — честная ошибка (фронт видит покрытие),
    // unauthed — пустышка, иначе sendTwoFa — оракул «юзер отключил 2ФА»
    let dummy = false;
    let typeNames = effectiveTypes;
    if (effectiveTypes.length === 0) {
      if (actor.authed) {
        throw new TwoFaError(TwoFaErrorCode.MethodNotCovered);
      }
      dummy = true;
      typeNames = await this._methodConfiguredTypes(method.id);
    }
    // анти-enumeration (signin): неизвестный/неподтверждённый identity → пустышка
    if (!actor.authed && !isRegistration && !actor.user) {
      dummy = true;
    }

    const prepared = await this._prepareTypes(typeNames, actor, {
      dummy,
      isRegistration,
    });

    const { operation, outbox, responseTypes } =
      await this._dataSource.transaction(async (manager) => {
        await this._enforceLimits(method, actor, manager);
        const expiresAt = new Date(Date.now() + this._ttlSeconds * 1000);
        const created = await this._operationsCrud.create(
          {
            userId: actor.user?.id ?? null,
            methodId: method.id,
            identity: actor.authed ? null : actor.identity,
            clientIp: actor.authed ? null : actor.clientIp,
            status: OperationStatus.Pending,
            expiresAt,
          },
          manager,
        );
        const events: CodeSendEvent[] = [];
        const views: SendTwoFaTypeView[] = [];
        for (const type of prepared) {
          if (type.selfVerified) {
            await this._codesCrud.create(
              {
                operationId: created.id,
                typeId: type.typeId,
                codeHash: null,
                lastSentAt: null,
                expiresAt,
              },
              manager,
            );
            views.push({
              type: type.typeName,
              identity: null,
              expire: null,
              retry: null,
            });
            continue;
          }
          const code = this._codeGenerator.generate();
          await this._codesCrud.create(
            {
              operationId: created.id,
              typeId: type.typeId,
              codeHash: dummy
                ? this._codeGenerator.randomHash()
                : this._codeGenerator.hash(code),
              lastSentAt: new Date(),
              expiresAt,
            },
            manager,
          );
          if (!dummy && type.destination) {
            events.push(
              this._buildEvent(code, type, created.id, params.locale),
            );
          }
          views.push({
            type: type.typeName,
            identity: type.maskedIdentity,
            expire: this._ttlSeconds,
            retry: this._retrySeconds,
          });
        }
        return { operation: created, outbox: events, responseTypes: views };
      });

    this._publishAfterCommit(outbox);
    return { operationId: operation.id, types: responseTypes };
  }

  // ---------- переотправка ----------

  private async _resend(
    params: SendTwoFaParams,
    method: Method,
    tagNames: string[],
    actor: ActorContext,
  ): Promise<SendTwoFaResult> {
    const isRegistration =
      tagNames.includes(TAG_SYSTEM) && tagNames.includes(TAG_UNAUTHED);
    const { outbox, responseTypes, operationId } =
      await this._dataSource.transaction(async (manager) => {
        const operation = await this._operationsCrud.findByIdForUpdate(
          params.operationId as string,
          manager,
        );
        this._assertOperationBinding(operation, method, actor);
        const activeOperation = operation as Operation;
        this._assertPending(activeOperation);
        if (activeOperation.expiresAt.getTime() <= Date.now()) {
          await this._operationsCrud.updateStatusIf(
            activeOperation.id,
            OperationStatus.Pending,
            OperationStatus.Expired,
            manager,
          );
          throw new TwoFaError(TwoFaErrorCode.OperationExpired);
        }

        const codeRows = await this._codesCrud.findBy(
          { operationId: activeOperation.id },
          manager,
        );
        const typeNameById = await this._typeNameById(manager);
        const rowByTypeName = new Map(
          codeRows.map((row) => [typeNameById.get(row.typeId) as string, row]),
        );

        const targets = this._resolveResendTargets(params.types, rowByTypeName);

        // все проверки до первого изменения: retry-окно и лимит переотправок per-type
        const now = Date.now();
        for (const typeName of targets) {
          const row = rowByTypeName.get(typeName) as Code;
          if (
            row.lastSentAt &&
            row.lastSentAt.getTime() + this._retrySeconds * 1000 > now
          ) {
            throw new TwoFaError(
              TwoFaErrorCode.RetryNotAvailable,
              `Retry for type "${typeName}" is not available yet`,
            );
          }
          if (row.sendsCount + 1 > this._resendsLimit) {
            throw new TwoFaError(TwoFaErrorCode.ResendLimitExceeded);
          }
        }

        // назначения пересчитываются: для пустышки их нет — обновляем без публикации
        const prepared = await this._prepareTypes(
          targets,
          { ...actor, identity: activeOperation.identity ?? actor.identity },
          { dummy: false, isRegistration },
          { silentMissingCredential: !actor.authed },
        );
        const preparedByName = new Map(
          prepared.map((type) => [type.typeName, type]),
        );

        const events: CodeSendEvent[] = [];
        for (const typeName of targets) {
          const row = rowByTypeName.get(typeName) as Code;
          const type = preparedByName.get(typeName) as PreparedType;
          const code = this._codeGenerator.generate();
          await this._codesCrud.update(
            row.id,
            {
              codeHash: type.destination
                ? this._codeGenerator.hash(code)
                : this._codeGenerator.randomHash(),
              lastSentAt: new Date(),
              sendsCount: row.sendsCount + 1,
              // attempts намеренно не сбрасывается: resend ≠ новые попытки
            },
            manager,
          );
          if (type.destination) {
            events.push(
              this._buildEvent(code, type, activeOperation.id, params.locale),
            );
          }
        }

        const remaining = Math.max(
          0,
          Math.floor((activeOperation.expiresAt.getTime() - now) / 1000),
        );
        const views: SendTwoFaTypeView[] = [];
        for (const [typeName, row] of rowByTypeName) {
          if (row.codeHash === null && row.lastSentAt === null) {
            views.push({
              type: typeName,
              identity: null,
              expire: null,
              retry: null,
            });
            continue;
          }
          const maskSource = actor.authed
            ? preparedByName.get(typeName)?.maskedIdentity
            : this._masker.mask(activeOperation.identity ?? '');
          views.push({
            type: typeName,
            identity:
              maskSource ?? this._masker.mask(activeOperation.identity ?? ''),
            expire: remaining,
            retry: this._retrySeconds,
          });
        }
        return {
          outbox: events,
          responseTypes: views,
          operationId: activeOperation.id,
        };
      });

    this._publishAfterCommit(outbox);
    return { operationId, types: responseTypes };
  }

  // ---------- общие шаги ----------

  private async _loadMethod(
    methodName: string,
  ): Promise<{ method: Method; tagNames: string[] }> {
    const [method] = await this._methodsCrud.findBy({
      method: methodName,
      isDeleted: false,
    });
    if (!method || !method.isActive) {
      throw new TwoFaError(
        TwoFaErrorCode.UnknownMethod,
        `Method "${methodName}" does not exist`,
      );
    }
    const [tagRows, tags] = await Promise.all([
      this._methodTagsCrud.findBy({ methodId: method.id }),
      this._tagsCrud.findBy({}),
    ]);
    const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));
    return {
      method,
      tagNames: tagRows.map((row) => tagNameById.get(row.tagId) as string),
    };
  }

  private async _resolveActor(
    actor: SendActor,
    tagNames: string[],
  ): Promise<ActorContext> {
    if (actor.userId) {
      const [user] = await this._usersCrud.findBy({ userId: actor.userId });
      if (!user) {
        throw new TwoFaError(
          TwoFaErrorCode.IdentityNotFound,
          'User is not synchronized with 2FA service',
        );
      }
      return { authed: true, user, identity: null, clientIp: null };
    }
    // unauthed: метод обязан быть доступен без токена
    if (!tagNames.includes(TAG_UNAUTHED)) {
      throw new TwoFaError(TwoFaErrorCode.MethodNotAllowedUnauthed);
    }
    if (!actor.identity) {
      throw new TwoFaError(
        TwoFaErrorCode.IdentityNotFound,
        'identity is required for unauthenticated sendTwoFa',
      );
    }
    const normalized = this._normalizer.normalize(actor.identity);
    const credentials = await this._credentialsCrud.findBy({
      identity: normalized,
      isDeleted: false,
    });
    const confirmed = credentials.find(
      (credential) => credential.isConfirmed && credential.isActive,
    );
    const user = confirmed
      ? await this._usersCrud.findById(confirmed.userId)
      : null;
    return {
      authed: false,
      user,
      identity: normalized,
      clientIp: actor.clientIp ?? null,
    };
  }

  /**
   * Назначение и маска по каждому типу. Для регистрации (system + unauthed)
   * код уходит на переданный identity — владение подтверждается кодом.
   * Для юзера — на подтверждённый активный кред типа; отсутствие креда:
   * authed → честная ошибка, unauthed → silentMissingCredential (пустышка).
   */
  private async _prepareTypes(
    typeNames: string[],
    actor: ActorContext,
    flags: { dummy: boolean; isRegistration: boolean },
    options: { silentMissingCredential?: boolean } = {},
  ): Promise<PreparedType[]> {
    const types = await this._typesCrud.findBy({
      isActive: true,
      isDeleted: false,
    });
    const typeByName = new Map(types.map((type) => [type.type, type]));
    const prepared: PreparedType[] = [];
    for (const typeName of typeNames) {
      const type = typeByName.get(typeName);
      if (!type) {
        continue; // тип выключили после конфигурации метода — не отправляем
      }
      if (this._verifierRegistry.isSelfVerified(typeName)) {
        prepared.push({
          typeName,
          typeId: type.id,
          destination: null,
          maskedIdentity: null,
          selfVerified: true,
        });
        continue;
      }
      let destination: string | null = null;
      if (!flags.dummy) {
        if (flags.isRegistration && !actor.user) {
          destination = actor.identity;
        } else if (actor.user) {
          const [credential] = await this._credentialsCrud.findBy({
            userId: actor.user.id,
            typeId: type.id,
            isConfirmed: true,
            isActive: true,
            isDeleted: false,
          });
          if (credential) {
            destination = credential.identity;
          } else if (actor.authed && !options.silentMissingCredential) {
            throw new TwoFaError(
              TwoFaErrorCode.IdentityNotFound,
              `No confirmed credential for type "${typeName}"`,
            );
          }
        }
      }
      const maskSource = destination ?? actor.identity;
      prepared.push({
        typeName,
        typeId: type.id,
        destination,
        maskedIdentity: maskSource ? this._masker.mask(maskSource) : null,
        selfVerified: false,
      });
    }
    return prepared;
  }

  /**
   * Анти-флуд, два измерения, под advisory lock — параллельные sendTwoFa
   * не проскакивают порог. Пустышки учитываются наравне с настоящими.
   */
  private async _enforceLimits(
    method: Method,
    actor: ActorContext,
    manager: EntityManager,
  ): Promise<void> {
    const actorKey = actor.authed
      ? `user:${(actor.user as User).id}`
      : `identity:${actor.identity}`;
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `2fa:${actorKey}:${method.method}`,
    ]);
    const daySince = new Date(Date.now() - DAY_MS);
    const dayOperations = await this._operationsCrud.findBy(
      actor.authed
        ? {
            userId: (actor.user as User).id,
            methodId: method.id,
            createdAt: MoreThanOrEqual(daySince),
          }
        : {
            identity: actor.identity as string,
            methodId: method.id,
            createdAt: MoreThanOrEqual(daySince),
          },
      manager,
    );
    if (dayOperations.length >= this._operationsPerDay) {
      throw new TwoFaError(TwoFaErrorCode.DailyOperationsLimitExceeded);
    }
    if (!actor.authed && actor.clientIp) {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `2fa:ip:${actor.clientIp}`,
      ]);
      const hourSince = new Date(Date.now() - HOUR_MS);
      const hourOperations = await this._operationsCrud.findBy(
        { clientIp: actor.clientIp, createdAt: MoreThanOrEqual(hourSince) },
        manager,
      );
      if (hourOperations.length >= this._ipHourlyLimit) {
        throw new TwoFaError(TwoFaErrorCode.IpLimitExceeded);
      }
    }
  }

  private _assertOperationBinding(
    operation: Operation | null,
    method: Method,
    actor: ActorContext,
  ): void {
    const bound =
      operation !== null &&
      operation.methodId === method.id &&
      (actor.authed
        ? operation.userId === (actor.user as User).id
        : operation.identity === actor.identity);
    if (!bound) {
      // несовпадение привязки неотличимо от «операция не найдена»
      throw new TwoFaError(TwoFaErrorCode.UnknownOperation);
    }
  }

  private _assertPending(operation: Operation): void {
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

  private _resolveResendTargets(
    requested: string[] | undefined,
    rowByTypeName: Map<string, Code>,
  ): string[] {
    const sendable = [...rowByTypeName.keys()].filter(
      (typeName) => !this._verifierRegistry.isSelfVerified(typeName),
    );
    if (!requested || requested.length === 0) {
      return sendable;
    }
    const targets = [...new Set(requested)];
    for (const typeName of targets) {
      if (!rowByTypeName.has(typeName)) {
        throw new TwoFaError(
          TwoFaErrorCode.UnknownType,
          `Type "${typeName}" is not a part of the operation`,
        );
      }
      if (this._verifierRegistry.isSelfVerified(typeName)) {
        throw new TwoFaError(
          TwoFaErrorCode.UnknownType,
          `Type "${typeName}" cannot be resent`,
        );
      }
    }
    return targets;
  }

  /** Конфигурация метода без учёта юзера — типы для операции-пустышки. */
  private async _methodConfiguredTypes(methodId: string): Promise<string[]> {
    const [typeNameById, methodTypes] = await Promise.all([
      this._typeNameById(),
      this._methodTypesCrud.findBy({ methodId }),
    ]);
    return methodTypes
      .map((row) => typeNameById.get(row.typeId))
      .filter((name): name is string => name !== undefined);
  }

  private async _typeNameById(
    manager?: EntityManager,
  ): Promise<Map<string, string>> {
    const types = await this._typesCrud.findBy({}, manager);
    return new Map(types.map((type) => [type.id, type.type]));
  }

  private _buildEvent(
    code: string,
    type: PreparedType,
    operationId: string,
    locale?: string,
  ): CodeSendEvent {
    return {
      event: this._eventName,
      data: {
        data: {
          code,
          sentAt: new Date().toISOString(),
          operationId,
          ...(locale ? { locale } : {}),
        },
        destination: {
          address: type.destination as string,
          providerName: this._providerByType[type.typeName] ?? type.typeName,
        },
      },
    };
  }

  /**
   * Публикация после коммита, fire-and-forget вне hot path: await добавлял бы
   * латентность и делал пустышки отличимыми по времени ответа. Ошибка
   * логируется без содержимого события (код не попадает в логи);
   * recovery-путь — переотправка.
   */
  private _publishAfterCommit(events: CodeSendEvent[]): void {
    for (const event of events) {
      this._publisher.publish(event).catch((error: Error) => {
        this._logger.error(
          `Failed to publish 2FA code event for operation ${event.data.data.operationId}: ${error.message}`,
        );
      });
    }
  }
}
