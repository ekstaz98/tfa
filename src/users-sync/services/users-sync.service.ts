import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  TypesCrudService,
  UserCredentialsCrudService,
  UsersCrudService,
} from '../../database/crud';
import { User } from '../../database/entities';
import { IdentityNormalizerService } from '../../operations/services';
import { UserMethodPolicyService } from '../../methods/services';
import { UserSyncEvent } from '../interfaces';

/** Битый payload: не реквьюится (вечный цикл), сообщение подтверждается и логируется. */
export class InvalidUserSyncEventError extends Error {}

/**
 * Синхронизация юзеров из событий интегрирующей системы.
 * Upsert строго по (user_id, type_id) среди неудалённых — повторная
 * доставка (at-least-once) не создаёт дублей и молча не выключает каналы
 * (анти-урок старого сервиса). Identity нормализуется; креды из событий —
 * is_confirmed = true (канал верифицирован на стороне интегрирующей системы).
 * Новый юзер стартует с users.default_methods_enabled по
 * UserMethodPolicyService.defaultMethodsActive — уже
 * существующего юзера повторная доставка не трогает (идемпотентность).
 */
@Injectable()
export class UsersSyncService {
  private readonly _logger = new Logger(UsersSyncService.name);

  constructor(
    private readonly _dataSource: DataSource,
    private readonly _usersCrud: UsersCrudService,
    private readonly _typesCrud: TypesCrudService,
    private readonly _credentialsCrud: UserCredentialsCrudService,
    private readonly _normalizer: IdentityNormalizerService,
    private readonly _userMethodPolicy: UserMethodPolicyService,
  ) {}

  parseEvent(payload: unknown): UserSyncEvent {
    const event = payload as UserSyncEvent | null;
    if (
      !event ||
      typeof event.userId !== 'string' ||
      event.userId.length === 0 ||
      !Array.isArray(event.credentials) ||
      event.credentials.some(
        (credential) =>
          typeof credential?.type !== 'string' ||
          typeof credential?.identity !== 'string' ||
          credential.identity.trim().length === 0,
      )
    ) {
      throw new InvalidUserSyncEventError(
        'Expected { userId, credentials: [{ type, identity }] }',
      );
    }
    return event;
  }

  async syncUser(event: UserSyncEvent): Promise<void> {
    const types = await this._typesCrud.findBy({
      isActive: true,
      isDeleted: false,
    });
    const typeIdByName = new Map(types.map((type) => [type.type, type.id]));

    await this._dataSource.transaction(async (manager) => {
      const user = await this._upsertUser(event.userId, manager);
      // дубли типов в событии: действует последний
      const byType = new Map(
        event.credentials.map((credential) => [credential.type, credential]),
      );
      for (const credential of byType.values()) {
        const typeId = typeIdByName.get(credential.type);
        if (!typeId) {
          // неизвестный тип не валит событие целиком — канал появится
          // после INSERT в справочник и повторной доставки/обновления
          this._logger.warn(
            `Unknown credential type "${credential.type}" for user ${event.userId}, skipped`,
          );
          continue;
        }
        await this._upsertCredential(
          user,
          typeId,
          this._normalizer.normalize(credential.identity),
          manager,
        );
      }
    });
  }

  private async _upsertUser(
    coreUserId: string,
    manager: EntityManager,
  ): Promise<User> {
    const [existing] = await this._usersCrud.findBy(
      { userId: coreUserId },
      manager,
    );
    if (existing) {
      return existing;
    }
    return this._usersCrud.create(
      {
        userId: coreUserId,
        defaultMethodsEnabled:
          this._userMethodPolicy.defaultMethodsActive,
      },
      manager,
    );
  }

  private async _upsertCredential(
    user: User,
    typeId: string,
    identity: string,
    manager: EntityManager,
  ): Promise<void> {
    const [existing] = await this._credentialsCrud.findBy(
      { userId: user.id, typeId, isDeleted: false },
      manager,
    );
    if (existing && existing.identity === identity) {
      return; // идемпотентность: ничего не изменилось
    }
    if (existing) {
      // identity сменился: старый канал закрывается, новый — insert
      await this._credentialsCrud.softDelete(existing.id, manager);
    }
    await this._credentialsCrud.create(
      {
        userId: user.id,
        typeId,
        identity,
        isConfirmed: true,
        isActive: true,
      },
      manager,
    );
  }
}
