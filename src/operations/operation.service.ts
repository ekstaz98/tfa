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
} from '../database/crud';
import {
  Code,
  Method,
  Operation,
  OperationStatus,
  User,
} from '../database/entities';
import { TwoFaError, TwoFaErrorCode } from '../errors';
import { TAG_SYSTEM, TAG_UNAUTHED } from '../methods/constants';
import { EffectiveMethodsResolverService } from '../methods/services';
import { CodeGeneratorService } from './code-generator.service';
import {
  IdentityMaskerService,
  IdentityNormalizerService,
} from './identity.service';
import {
  CODE_SEND_PUBLISHER,
  CodeSendEvent,
  CodeSendPublisherPort,
} from './ports/code-send-publisher.port';
import { VerifierRegistry } from './ports/verifier-registry';

export interface SendActor {
  /** core userId авторизованного клиента (из заголовков гейтвея). */
  userId?: string | null;
  /** identity неавторизованного клиента (signin, регистрация). */
  identity?: string | null;
  /** client IP из заголовка гейтвея — опора часового IP-лимита. */
  clientIp?: string | null;
}

export interface Send2FaParams {
  method: string;
  actor: SendActor;
  /** Подмножество типов для переотправки; только вместе с operationId. */
  types?: string[];
  locale?: string;
  /** x-2fa-operationId: переотправка по существующей операции. */
  operationId?: string;
}

export interface Send2FaTypeView {
  type: string;
  identity: string | null;
  expire: number | null;
  retry: number | null;
}

export interface Send2FaResult {
  operationId: string;
  types: Send2FaTypeView[];
}

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

/** send2Fa: создание операции, генерация и публикация кодов, переотправка. */
@Injectable()
export class OperationService {
  private readonly logger = new Logger(OperationService.name);
  private readonly ttlSeconds: number;
  private readonly retrySeconds: number;
  private readonly resendsLimit: number;
  private readonly operationsPerDay: number;
  private readonly ipHourlyLimit: number;
  private readonly eventName: string;
  private readonly providerByType: Record<string, string>;

  constructor(
    config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly methodsCrud: MethodsCrudService,
    private readonly methodTypesCrud: MethodTypesCrudService,
    private readonly methodTagsCrud: MethodTagsCrudService,
    private readonly tagsCrud: TagsCrudService,
    private readonly typesCrud: TypesCrudService,
    private readonly usersCrud: UsersCrudService,
    private readonly credentialsCrud: UserCredentialsCrudService,
    private readonly operationsCrud: OperationsCrudService,
    private readonly codesCrud: CodesCrudService,
    private readonly effectiveMethods: EffectiveMethodsResolverService,
    private readonly codeGenerator: CodeGeneratorService,
    private readonly normalizer: IdentityNormalizerService,
    private readonly masker: IdentityMaskerService,
    private readonly verifierRegistry: VerifierRegistry,
    @Inject(CODE_SEND_PUBLISHER)
    private readonly publisher: CodeSendPublisherPort,
  ) {
    this.ttlSeconds = config.getOrThrow<number>('codes.ttlSeconds');
    this.retrySeconds = config.getOrThrow<number>('codes.retrySeconds');
    this.resendsLimit = config.getOrThrow<number>('codes.resendsLimit');
    this.operationsPerDay = config.getOrThrow<number>(
      'limits.operationsPerDay',
    );
    this.ipHourlyLimit = config.getOrThrow<number>(
      'limits.unauthedOpsPerHourPerIp',
    );
    this.eventName = config.getOrThrow<string>('sendEvent.name');
    this.providerByType = config.getOrThrow<Record<string, string>>(
      'sendEvent.providerByType',
    );
  }

  async send2Fa(params: Send2FaParams): Promise<Send2FaResult> {
    const { method, tagNames } = await this.loadMethod(params.method);
    const actor = await this.resolveActor(params.actor, tagNames);
    if (params.operationId) {
      return this.resend(params, method, tagNames, actor);
    }
    return this.createOperation(params, method, tagNames, actor);
  }

  // ---------- создание операции ----------

  private async createOperation(
    params: Send2FaParams,
    method: Method,
    tagNames: string[],
    actor: ActorContext,
  ): Promise<Send2FaResult> {
    const isRegistration =
      tagNames.includes(TAG_SYSTEM) && tagNames.includes(TAG_UNAUTHED);
    const coreUserId = actor.authed
      ? (params.actor.userId as string)
      : (actor.user?.userId ?? null);

    const effective = await this.effectiveMethods.resolve(coreUserId);
    const effectiveTypes =
      effective.find((view) => view.id === method.id)?.types ?? [];

    // непокрытый метод: authed — честная ошибка (фронт видит покрытие),
    // unauthed — пустышка, иначе send2Fa — оракул «юзер отключил 2ФА»
    let dummy = false;
    let typeNames = effectiveTypes;
    if (effectiveTypes.length === 0) {
      if (actor.authed) {
        throw new TwoFaError(TwoFaErrorCode.MethodNotCovered);
      }
      dummy = true;
      typeNames = await this.methodConfiguredTypes(method.id);
    }
    // анти-enumeration (signin): неизвестный/неподтверждённый identity → пустышка
    if (!actor.authed && !isRegistration && !actor.user) {
      dummy = true;
    }

    const prepared = await this.prepareTypes(typeNames, actor, {
      dummy,
      isRegistration,
    });

    const { operation, outbox, responseTypes } =
      await this.dataSource.transaction(async (manager) => {
        await this.enforceLimits(method, actor, manager);
        const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
        const created = await this.operationsCrud.create(
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
        const views: Send2FaTypeView[] = [];
        for (const type of prepared) {
          if (type.selfVerified) {
            await this.codesCrud.create(
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
          const code = this.codeGenerator.generate();
          await this.codesCrud.create(
            {
              operationId: created.id,
              typeId: type.typeId,
              codeHash: dummy
                ? this.codeGenerator.randomHash()
                : this.codeGenerator.hash(code),
              lastSentAt: new Date(),
              expiresAt,
            },
            manager,
          );
          if (!dummy && type.destination) {
            events.push(this.buildEvent(code, type, created.id, params.locale));
          }
          views.push({
            type: type.typeName,
            identity: type.maskedIdentity,
            expire: this.ttlSeconds,
            retry: this.retrySeconds,
          });
        }
        return { operation: created, outbox: events, responseTypes: views };
      });

    this.publishAfterCommit(outbox);
    return { operationId: operation.id, types: responseTypes };
  }

  // ---------- переотправка ----------

  private async resend(
    params: Send2FaParams,
    method: Method,
    tagNames: string[],
    actor: ActorContext,
  ): Promise<Send2FaResult> {
    const isRegistration =
      tagNames.includes(TAG_SYSTEM) && tagNames.includes(TAG_UNAUTHED);
    const { outbox, responseTypes, operationId } =
      await this.dataSource.transaction(async (manager) => {
        const operation = await this.operationsCrud.findByIdForUpdate(
          params.operationId as string,
          manager,
        );
        this.assertOperationBinding(operation, method, actor);
        const activeOperation = operation as Operation;
        this.assertPending(activeOperation);
        if (activeOperation.expiresAt.getTime() <= Date.now()) {
          await this.operationsCrud.updateStatusIf(
            activeOperation.id,
            OperationStatus.Pending,
            OperationStatus.Expired,
            manager,
          );
          throw new TwoFaError(TwoFaErrorCode.OperationExpired);
        }

        const codeRows = await this.codesCrud.findBy(
          { operationId: activeOperation.id },
          manager,
        );
        const typeNameById = await this.typeNameById(manager);
        const rowByTypeName = new Map(
          codeRows.map((row) => [typeNameById.get(row.typeId) as string, row]),
        );

        const targets = this.resolveResendTargets(params.types, rowByTypeName);

        // все проверки до первого изменения: retry-окно и лимит переотправок per-type
        const now = Date.now();
        for (const typeName of targets) {
          const row = rowByTypeName.get(typeName) as Code;
          if (
            row.lastSentAt &&
            row.lastSentAt.getTime() + this.retrySeconds * 1000 > now
          ) {
            throw new TwoFaError(
              TwoFaErrorCode.RetryNotAvailable,
              `Retry for type "${typeName}" is not available yet`,
            );
          }
          if (row.sendsCount + 1 > this.resendsLimit) {
            throw new TwoFaError(TwoFaErrorCode.ResendLimitExceeded);
          }
        }

        // назначения пересчитываются: для пустышки их нет — обновляем без публикации
        const prepared = await this.prepareTypes(
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
          const code = this.codeGenerator.generate();
          await this.codesCrud.update(
            row.id,
            {
              codeHash: type.destination
                ? this.codeGenerator.hash(code)
                : this.codeGenerator.randomHash(),
              lastSentAt: new Date(),
              sendsCount: row.sendsCount + 1,
              // attempts намеренно не сбрасывается: resend ≠ новые попытки
            },
            manager,
          );
          if (type.destination) {
            events.push(
              this.buildEvent(code, type, activeOperation.id, params.locale),
            );
          }
        }

        const remaining = Math.max(
          0,
          Math.floor((activeOperation.expiresAt.getTime() - now) / 1000),
        );
        const views: Send2FaTypeView[] = [];
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
            : this.masker.mask(activeOperation.identity ?? '');
          views.push({
            type: typeName,
            identity:
              maskSource ?? this.masker.mask(activeOperation.identity ?? ''),
            expire: remaining,
            retry: this.retrySeconds,
          });
        }
        return {
          outbox: events,
          responseTypes: views,
          operationId: activeOperation.id,
        };
      });

    this.publishAfterCommit(outbox);
    return { operationId, types: responseTypes };
  }

  // ---------- общие шаги ----------

  private async loadMethod(
    methodName: string,
  ): Promise<{ method: Method; tagNames: string[] }> {
    const [method] = await this.methodsCrud.findBy({
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
      this.methodTagsCrud.findBy({ methodId: method.id }),
      this.tagsCrud.findBy({}),
    ]);
    const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));
    return {
      method,
      tagNames: tagRows.map((row) => tagNameById.get(row.tagId) as string),
    };
  }

  private async resolveActor(
    actor: SendActor,
    tagNames: string[],
  ): Promise<ActorContext> {
    if (actor.userId) {
      const [user] = await this.usersCrud.findBy({ userId: actor.userId });
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
        'identity is required for unauthenticated send2Fa',
      );
    }
    const normalized = this.normalizer.normalize(actor.identity);
    const credentials = await this.credentialsCrud.findBy({
      identity: normalized,
      isDeleted: false,
    });
    const confirmed = credentials.find(
      (credential) => credential.isConfirmed && credential.isActive,
    );
    const user = confirmed
      ? await this.usersCrud.findById(confirmed.userId)
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
  private async prepareTypes(
    typeNames: string[],
    actor: ActorContext,
    flags: { dummy: boolean; isRegistration: boolean },
    options: { silentMissingCredential?: boolean } = {},
  ): Promise<PreparedType[]> {
    const types = await this.typesCrud.findBy({
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
      if (this.verifierRegistry.isSelfVerified(typeName)) {
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
          const [credential] = await this.credentialsCrud.findBy({
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
        maskedIdentity: maskSource ? this.masker.mask(maskSource) : null,
        selfVerified: false,
      });
    }
    return prepared;
  }

  /**
   * Анти-флуд, два измерения, под advisory lock — параллельные send2Fa
   * не проскакивают порог. Пустышки учитываются наравне с настоящими.
   */
  private async enforceLimits(
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
    const dayOperations = await this.operationsCrud.findBy(
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
    if (dayOperations.length >= this.operationsPerDay) {
      throw new TwoFaError(TwoFaErrorCode.DailyOperationsLimitExceeded);
    }
    if (!actor.authed && actor.clientIp) {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `2fa:ip:${actor.clientIp}`,
      ]);
      const hourSince = new Date(Date.now() - HOUR_MS);
      const hourOperations = await this.operationsCrud.findBy(
        { clientIp: actor.clientIp, createdAt: MoreThanOrEqual(hourSince) },
        manager,
      );
      if (hourOperations.length >= this.ipHourlyLimit) {
        throw new TwoFaError(TwoFaErrorCode.IpLimitExceeded);
      }
    }
  }

  private assertOperationBinding(
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

  private resolveResendTargets(
    requested: string[] | undefined,
    rowByTypeName: Map<string, Code>,
  ): string[] {
    const sendable = [...rowByTypeName.keys()].filter(
      (typeName) => !this.verifierRegistry.isSelfVerified(typeName),
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
      if (this.verifierRegistry.isSelfVerified(typeName)) {
        throw new TwoFaError(
          TwoFaErrorCode.UnknownType,
          `Type "${typeName}" cannot be resent`,
        );
      }
    }
    return targets;
  }

  /** Конфигурация метода без учёта юзера — типы для операции-пустышки. */
  private async methodConfiguredTypes(methodId: string): Promise<string[]> {
    const [typeNameById, methodTypes] = await Promise.all([
      this.typeNameById(),
      this.methodTypesCrud.findBy({ methodId }),
    ]);
    return methodTypes
      .map((row) => typeNameById.get(row.typeId))
      .filter((name): name is string => name !== undefined);
  }

  private async typeNameById(
    manager?: EntityManager,
  ): Promise<Map<string, string>> {
    const types = await this.typesCrud.findBy({}, manager);
    return new Map(types.map((type) => [type.id, type.type]));
  }

  private buildEvent(
    code: string,
    type: PreparedType,
    operationId: string,
    locale?: string,
  ): CodeSendEvent {
    return {
      event: this.eventName,
      data: {
        data: {
          code,
          sentAt: new Date().toISOString(),
          operationId,
          ...(locale ? { locale } : {}),
        },
        destination: {
          address: type.destination as string,
          providerName: this.providerByType[type.typeName] ?? type.typeName,
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
  private publishAfterCommit(events: CodeSendEvent[]): void {
    for (const event of events) {
      this.publisher.publish(event).catch((error: Error) => {
        this.logger.error(
          `Failed to publish 2FA code event for operation ${event.data.data.operationId}: ${error.message}`,
        );
      });
    }
  }
}
