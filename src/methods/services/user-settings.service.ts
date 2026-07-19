import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  MethodTagsCrudService,
  MethodTypesCrudService,
  MethodsCrudService,
  UserCredentialsCrudService,
  UserMethodTypesCrudService,
  UserMethodsCrudService,
  UsersCrudService,
} from '../../database/crud';
import { DictionaryCacheService } from '../../database/services';
import { Method, User, UserMethod } from '../../database/entities';
import { TwoFaError, TwoFaErrorCode } from '../../errors';
import { TAG_SYSTEM, TAG_USER, TOTP_TYPE } from '../constants';
import {
  MethodView,
  MyMethodView,
  MyMethodsFilter,
  MyTwoFaSettingsView,
  TwoFaManagedBy,
  UpdateMyMethodInput,
} from '../interfaces';

/**
 * updateMyTwoFaMethod: переопределение методов юзером. Разрешено только
 * для методов с тегом user; типы — подмножество типов метода; для каждого
 * выбранного типа обязан быть подтверждённый активный кред (для ga — с
 * секретом) — юзер не может запереть сам себя настройкой. Сюда же входит
 * вкл/выкл типов (бывший toggleTwoFaForUser) — отдельного toggle нет.
 * Теги юзер не передаёт (user_method_tags заполняет система/админ).
 */
@Injectable()
export class UserSettingsService {
  constructor(
    private readonly _dataSource: DataSource,
    private readonly _usersCrud: UsersCrudService,
    private readonly _userCredentialsCrud: UserCredentialsCrudService,
    private readonly _userMethodsCrud: UserMethodsCrudService,
    private readonly _userMethodTypesCrud: UserMethodTypesCrudService,
    private readonly _methodsCrud: MethodsCrudService,
    private readonly _methodTypesCrud: MethodTypesCrudService,
    private readonly _methodTagsCrud: MethodTagsCrudService,
    private readonly _dictionaryCache: DictionaryCacheService,
  ) {}

  async updateMyMethods(
    coreUserId: string,
    inputs: UpdateMyMethodInput[],
  ): Promise<MethodView[]> {
    const user = await this._requireUser(coreUserId);
    const {
      activeTypeByName: typeByName,
      activeTypeNameById: typeNameById,
      tagNameById,
    } = await this._dictionaryCache.get();

    return this._dataSource.transaction(async (manager) => {
      const views: MethodView[] = [];
      for (const input of inputs) {
        views.push(
          await this._updateOne(user, input, {
            manager,
            typeByName,
            typeNameById,
            tagNameById,
          }),
        );
      }
      return views;
    });
  }

  /**
   * Query myTwoFaMethods: все настраиваемые юзером методы (теги
   * user/default), включая выключенные и с нулём эффективных типов —
   * twoFaMethods такие не показывает, а экрану настроек нужны и id для
   * повторного включения, и allowedTypes для выбора.
   * isEnabled = метод реально требует 2ФА. filter — опциональное сужение
   * выдачи (см. MyMethodsFilter), без него отдаётся весь список.
   */
  async listMyMethods(
    coreUserId: string,
    filter: MyMethodsFilter = {},
  ): Promise<MyMethodView[]> {
    const user = await this._requireUser(coreUserId);
    const { tagNameById, activeTypeNameById } =
      await this._dictionaryCache.get();

    const methods = await this._methodsCrud.findBy({
      isActive: true,
      isDeleted: false,
    });
    if (methods.length === 0) {
      return [];
    }
    const methodIds = methods.map((method) => method.id);
    const [tagRows, typeRows, userMethods] = await Promise.all([
      this._methodTagsCrud.findBy({ methodId: In(methodIds) }),
      this._methodTypesCrud.findBy({ methodId: In(methodIds) }),
      this._userMethodsCrud.findBy({ userId: user.id, isDeleted: false }),
    ]);
    const overrideByMethodId = new Map(
      userMethods.map((userMethod) => [userMethod.methodId, userMethod]),
    );
    const overrideTypeRows =
      userMethods.length > 0
        ? await this._userMethodTypesCrud.findBy({
            userMethodId: In(userMethods.map((userMethod) => userMethod.id)),
          })
        : [];
    const overrideTypeIdsByUserMethodId = new Map<string, string[]>();
    for (const row of overrideTypeRows) {
      const list = overrideTypeIdsByUserMethodId.get(row.userMethodId) ?? [];
      list.push(row.typeId);
      overrideTypeIdsByUserMethodId.set(row.userMethodId, list);
    }

    const views: MyMethodView[] = [];
    for (const method of methods) {
      const tagNames = tagRows
        .filter((row) => row.methodId === method.id)
        .map((row) => tagNameById.get(row.tagId) as string);
      // system юзером не управляется вовсе; default — общим переключателем
      if (tagNames.includes(TAG_SYSTEM)) {
        continue;
      }
      const managedBy = tagNames.includes(TAG_USER)
        ? TwoFaManagedBy.METHOD
        : TwoFaManagedBy.GLOBAL;
      const allowedTypes = typeRows
        .filter((row) => row.methodId === method.id)
        .map((row) => activeTypeNameById.get(row.typeId))
        .filter((name): name is string => name !== undefined)
        .sort();

      let enabledTypes = allowedTypes;
      if (managedBy === 'method') {
        const override = overrideByMethodId.get(method.id);
        if (override) {
          enabledTypes = override.isActive
            ? (overrideTypeIdsByUserMethodId.get(override.id) ?? [])
                .map((typeId) => activeTypeNameById.get(typeId))
                .filter((name): name is string => name !== undefined)
                .sort()
            : [];
        }
      } else if (managedBy === 'global' && !user.defaultMethodsEnabled) {
        enabledTypes = [];
      }

      const view: MyMethodView = {
        id: method.id,
        method: method.method,
        isEnabled: enabledTypes.length > 0,
        allowedTypes,
        enabledTypes,
        tags: [...tagNames].sort(),
        managedBy,
      };
      if (this._matchesFilter(view, filter)) {
        views.push(view);
      }
    }
    return views;
  }

  private _matchesFilter(view: MyMethodView, filter: MyMethodsFilter): boolean {
    if (filter.managedBy && !filter.managedBy.includes(view.managedBy)) {
      return false;
    }
    if (filter.isEnabled !== undefined && view.isEnabled !== filter.isEnabled) {
      return false;
    }
    if (filter.tags && !filter.tags.every((tag) => view.tags.includes(tag))) {
      return false;
    }
    if (
      filter.allowedTypes &&
      !filter.allowedTypes.every((type) => view.allowedTypes.includes(type))
    ) {
      return false;
    }
    if (
      filter.enabledTypes &&
      !filter.enabledTypes.every((type) => view.enabledTypes.includes(type))
    ) {
      return false;
    }
    return true;
  }

  /** Query myTwoFaSettings: общий переключатель default-методов. */
  async getMySettings(coreUserId: string): Promise<MyTwoFaSettingsView> {
    const user = await this._requireUser(coreUserId);
    return { defaultMethodsEnabled: user.defaultMethodsEnabled };
  }

  /**
   * Mutation updateMyTwoFaDefaults: вкл/выкл 2ФА разом на всех методах
   * режима default. На user-методы (индивидуальные переопределения)
   * и system не влияет.
   */
  async updateMyDefaults(
    coreUserId: string,
    isEnabled: boolean,
  ): Promise<MyTwoFaSettingsView> {
    const user = await this._requireUser(coreUserId);
    if (user.defaultMethodsEnabled !== isEnabled) {
      await this._usersCrud.update(user.id, {
        defaultMethodsEnabled: isEnabled,
      });
    }
    return { defaultMethodsEnabled: isEnabled };
  }

  private async _requireUser(coreUserId: string): Promise<User> {
    const [user] = await this._usersCrud.findBy({ userId: coreUserId });
    if (!user) {
      throw new TwoFaError(
        TwoFaErrorCode.IdentityNotFound,
        'User is not synchronized with 2FA service',
      );
    }
    return user;
  }

  private async _updateOne(
    user: User,
    input: UpdateMyMethodInput,
    context: {
      manager: EntityManager;
      typeByName: Map<string, { id: string; type: string }>;
      typeNameById: Map<string, string>;
      tagNameById: Map<string, string>;
    },
  ): Promise<MethodView> {
    const { manager } = context;
    const method = await this._methodsCrud.findById(input.id, manager);
    if (!method || method.isDeleted) {
      throw new TwoFaError(
        TwoFaErrorCode.UnknownMethod,
        `Method with id "${input.id}" does not exist`,
      );
    }

    const methodTagNames = (
      await this._methodTagsCrud.findBy({ methodId: method.id }, manager)
    ).map((row) => context.tagNameById.get(row.tagId) as string);
    if (!methodTagNames.includes(TAG_USER)) {
      throw new TwoFaError(
        TwoFaErrorCode.MethodNotConfigurable,
        `Method "${method.method}" cannot be configured by user`,
      );
    }

    const allowedTypeIds = new Set(
      (
        await this._methodTypesCrud.findBy({ methodId: method.id }, manager)
      ).map((row) => row.typeId),
    );

    let typeIds: string[] | undefined;
    if (input.types) {
      typeIds = [...new Set(input.types)].map((name) => {
        const type = context.typeByName.get(name);
        if (!type || !allowedTypeIds.has(type.id)) {
          throw new TwoFaError(
            TwoFaErrorCode.UnknownType,
            `Type "${name}" is not available for method "${method.method}"`,
          );
        }
        return type.id;
      });
      await this._assertConfirmedCredentials(user, typeIds, context);
    }

    const userMethod = await this._upsertUserMethod(
      user,
      method,
      input,
      manager,
    );
    if (typeIds) {
      await this._diffUserMethodTypes(userMethod.id, typeIds, manager);
    }

    const currentTypeRows = await this._userMethodTypesCrud.findBy(
      { userMethodId: userMethod.id },
      manager,
    );
    return {
      id: method.id,
      method: method.method,
      isActive: userMethod.isActive,
      isDeleted: method.isDeleted,
      types: currentTypeRows
        .map((row) => context.typeNameById.get(row.typeId) as string)
        .sort(),
      tags: [...methodTagNames].sort(),
    };
  }

  /** Юзер не может выбрать канал, которым не владеет: кред подтверждён и активен, для TOTP — с секретом. */
  private async _assertConfirmedCredentials(
    user: User,
    typeIds: string[],
    context: {
      manager: EntityManager;
      typeNameById: Map<string, string>;
    },
  ): Promise<void> {
    if (typeIds.length === 0) {
      return;
    }
    const credentials = await this._userCredentialsCrud.findBy(
      {
        userId: user.id,
        typeId: In(typeIds),
        isConfirmed: true,
        isActive: true,
        isDeleted: false,
      },
      context.manager,
    );
    const credentialByTypeId = new Map(
      credentials.map((credential) => [credential.typeId, credential]),
    );
    for (const typeId of typeIds) {
      const typeName = context.typeNameById.get(typeId) as string;
      const credential = credentialByTypeId.get(typeId);
      if (!credential || (typeName === TOTP_TYPE && !credential.secret)) {
        throw new TwoFaError(
          TwoFaErrorCode.IdentityNotFound,
          `No confirmed credential for type "${typeName}"`,
        );
      }
    }
  }

  private async _upsertUserMethod(
    user: User,
    method: Method,
    input: UpdateMyMethodInput,
    manager: EntityManager,
  ): Promise<UserMethod> {
    const [existing] = await this._userMethodsCrud.findBy(
      { userId: user.id, methodId: method.id, isDeleted: false },
      manager,
    );
    if (!existing) {
      return this._userMethodsCrud.create(
        {
          userId: user.id,
          methodId: method.id,
          isActive: input.isActive ?? true,
        },
        manager,
      );
    }
    if (input.isActive !== undefined && input.isActive !== existing.isActive) {
      await this._userMethodsCrud.update(
        existing.id,
        { isActive: input.isActive },
        manager,
      );
      existing.isActive = input.isActive;
    }
    return existing;
  }

  private async _diffUserMethodTypes(
    userMethodId: string,
    targetTypeIds: string[],
    manager: EntityManager,
  ): Promise<void> {
    const current = await this._userMethodTypesCrud.findBy(
      { userMethodId },
      manager,
    );
    const target = new Set(targetTypeIds);
    const existing = new Set(
      current.map((row) => row.typeId).filter((typeId) => target.has(typeId)),
    );
    await this._userMethodTypesCrud.deleteMany(
      current.filter((row) => !target.has(row.typeId)).map((row) => row.id),
      manager,
    );
    await this._userMethodTypesCrud.createMany(
      [...target]
        .filter((typeId) => !existing.has(typeId))
        .map((typeId) => ({ userMethodId, typeId })),
      manager,
    );
  }
}
