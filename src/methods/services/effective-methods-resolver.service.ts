import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import {
  MethodTagsCrudService,
  MethodTypesCrudService,
  MethodsCrudService,
  UserMethodTypesCrudService,
  UserMethodsCrudService,
  UsersCrudService,
} from '../../database/crud';
import { DictionaryCacheService } from '../../database/services';
import { Method, User } from '../../database/entities';
import { TwoFaError, TwoFaErrorCode } from '../../errors';
import { TAG_SYSTEM, TAG_UNAUTHED, TAG_USER } from './../constants';
import { MethodView } from '../interfaces';

/** Актор для резолва: загруженный юзер, core userId или null (аноним). */
export type EffectiveActor = User | string | null;

/**
 * Резолв эффективных требований 2ФА для (userId | null, tags[]).
 * Режимные теги: system — user_methods игнорируются, 2ФА для всех;
 * default (или метод без режимного тега) — конфигурация метода, но все
 * такие методы разом гасятся общим переключателем юзера
 * users.default_methods_enabled; user — запись в user_methods =
 * индивидуальное переопределение юзера.
 * unauthed — ортогональный модификатор: userId = null видит только их.
 * Методы с 0 эффективных типов в требования не попадают.
 */
@Injectable()
export class EffectiveMethodsResolverService {
  constructor(
    private readonly _usersCrud: UsersCrudService,
    private readonly _methodsCrud: MethodsCrudService,
    private readonly _methodTypesCrud: MethodTypesCrudService,
    private readonly _methodTagsCrud: MethodTagsCrudService,
    private readonly _userMethodsCrud: UserMethodsCrudService,
    private readonly _userMethodTypesCrud: UserMethodTypesCrudService,
    private readonly _dictionaryCache: DictionaryCacheService,
  ) {}

  async resolve(
    coreUserId: string | null,
    filterTags: string[] = [],
  ): Promise<MethodView[]> {
    const {
      tagNameById,
      knownTagNames,
      activeTypeNameById: typeNameById,
    } = await this._dictionaryCache.get();
    for (const name of filterTags) {
      if (!knownTagNames.has(name)) {
        throw new TwoFaError(
          TwoFaErrorCode.UnknownTag,
          `Tag "${name}" does not exist`,
        );
      }
    }

    const methods = await this._methodsCrud.findBy({
      isActive: true,
      isDeleted: false,
    });
    if (methods.length === 0) {
      return [];
    }
    const methodIds = methods.map((method) => method.id);
    const [methodTypeRows, methodTagRows] = await Promise.all([
      this._methodTypesCrud.findBy({ methodId: In(methodIds) }),
      this._methodTagsCrud.findBy({ methodId: In(methodIds) }),
    ]);

    const overrides = await this._loadOverrides(coreUserId);

    const views: MethodView[] = [];
    for (const method of methods) {
      const tagNames = methodTagRows
        .filter((row) => row.methodId === method.id)
        .map((row) => tagNameById.get(row.tagId) as string);

      if (coreUserId === null && !tagNames.includes(TAG_UNAUTHED)) {
        continue;
      }
      if (!filterTags.every((tag) => tagNames.includes(tag))) {
        continue;
      }

      let typeNames = methodTypeRows
        .filter((row) => row.methodId === method.id)
        .map((row) => typeNameById.get(row.typeId))
        .filter((name): name is string => name !== undefined);

      // user — индивидуальное переопределение; default/без режимного тега —
      // общий переключатель юзера; system не гасится ничем
      if (tagNames.includes(TAG_USER)) {
        const override = overrides?.byMethodId.get(method.id);
        if (overrides && override) {
          typeNames = this._applyOverride(
            override.isActive,
            overrides.typeIdsByUserMethodId.get(override.id) ?? [],
            typeNameById,
          );
        }
      } else if (
        !tagNames.includes(TAG_SYSTEM) &&
        overrides &&
        !overrides.user.defaultMethodsEnabled
      ) {
        typeNames = [];
      }

      if (typeNames.length === 0) {
        continue;
      }
      views.push({
        id: method.id,
        method: method.method,
        isActive: method.isActive,
        isDeleted: method.isDeleted,
        types: [...typeNames].sort(),
        tags: [...tagNames].sort(),
      });
    }
    return views;
  }

  /**
   * Эффективные типы ОДНОГО метода — та же логика режимов, что и resolve(),
   * но без загрузки всей конфигурации: запросы только по этому методу.
   * Пустой список = метод не покрыт для актора. method обязан быть
   * активным неудалённым (гарантируется вызывающим); tagNames — теги метода,
   * null, если вызывающий их ещё не загружал. Уже загруженный User
   * передаётся как есть — повторного запроса юзера нет.
   */
  async resolveMethodTypes(
    method: Method,
    tagNames: string[] | null,
    actor: EffectiveActor,
  ): Promise<string[]> {
    const { tagNameById, activeTypeNameById } =
      await this._dictionaryCache.get();
    const methodTagNames =
      tagNames ??
      (await this._methodTagsCrud.findBy({ methodId: method.id })).map(
        (row) => tagNameById.get(row.tagId) as string,
      );
    if (actor === null && !methodTagNames.includes(TAG_UNAUTHED)) {
      return [];
    }

    const typeRows = await this._methodTypesCrud.findBy({
      methodId: method.id,
    });
    let typeNames = typeRows
      .map((row) => activeTypeNameById.get(row.typeId))
      .filter((name): name is string => name !== undefined);

    if (methodTagNames.includes(TAG_USER)) {
      const user = await this._resolveUser(actor);
      if (user) {
        const [override] = await this._userMethodsCrud.findBy({
          userId: user.id,
          methodId: method.id,
          isDeleted: false,
        });
        if (override) {
          const overrideTypeRows = override.isActive
            ? await this._userMethodTypesCrud.findBy({
                userMethodId: override.id,
              })
            : [];
          typeNames = this._applyOverride(
            override.isActive,
            overrideTypeRows.map((row) => row.typeId),
            activeTypeNameById,
          );
        }
      }
    } else if (!methodTagNames.includes(TAG_SYSTEM)) {
      // default/без режимного тега: общий переключатель юзера
      const user = await this._resolveUser(actor);
      if (user && !user.defaultMethodsEnabled) {
        return [];
      }
    }
    return typeNames;
  }

  /** Типы после применения user-переопределения: выключено → пусто. */
  private _applyOverride(
    isActive: boolean,
    overrideTypeIds: string[],
    activeTypeNameById: Map<string, string>,
  ): string[] {
    if (!isActive) {
      return [];
    }
    return overrideTypeIds
      .map((typeId) => activeTypeNameById.get(typeId))
      .filter((name): name is string => name !== undefined);
  }

  private async _resolveUser(actor: EffectiveActor): Promise<User | null> {
    if (actor === null || typeof actor !== 'string') {
      return actor;
    }
    const [user] = await this._usersCrud.findBy({ userId: actor });
    // юзер ещё не синхронизирован — переопределений нет
    return user ?? null;
  }

  private async _loadOverrides(coreUserId: string | null): Promise<{
    user: User;
    byMethodId: Map<string, { id: string; isActive: boolean }>;
    typeIdsByUserMethodId: Map<string, string[]>;
  } | null> {
    if (coreUserId === null) {
      return null;
    }
    const [user] = await this._usersCrud.findBy({ userId: coreUserId });
    if (!user) {
      // юзер ещё не синхронизирован — переопределений нет, действует конфигурация методов
      return null;
    }
    const userMethods = await this._userMethodsCrud.findBy({
      userId: user.id,
      isDeleted: false,
    });
    if (userMethods.length === 0) {
      return { user, byMethodId: new Map(), typeIdsByUserMethodId: new Map() };
    }
    const typeRows = await this._userMethodTypesCrud.findBy({
      userMethodId: In(userMethods.map((userMethod) => userMethod.id)),
    });
    const typeIdsByUserMethodId = new Map<string, string[]>();
    for (const row of typeRows) {
      const list = typeIdsByUserMethodId.get(row.userMethodId) ?? [];
      list.push(row.typeId);
      typeIdsByUserMethodId.set(row.userMethodId, list);
    }
    return {
      user,
      byMethodId: new Map(
        userMethods.map((userMethod) => [
          userMethod.methodId,
          { id: userMethod.id, isActive: userMethod.isActive },
        ]),
      ),
      typeIdsByUserMethodId,
    };
  }
}
