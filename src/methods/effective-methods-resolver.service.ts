import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import {
  MethodTagsCrudService,
  MethodTypesCrudService,
  MethodsCrudService,
  TagsCrudService,
  TypesCrudService,
  UserMethodTypesCrudService,
  UserMethodsCrudService,
  UsersCrudService,
} from '../database/crud';
import { TwoFaError, TwoFaErrorCode } from '../errors';
import { TAG_UNAUTHED, TAG_USER } from './constants';
import { MethodView } from './method-view';

/**
 * Резолв эффективных требований 2ФА для (userId | null, tags[]).
 * Режимные теги: system — user_methods игнорируются, 2ФА для всех;
 * default (или метод без режимного тега) — конфигурация метода для всех;
 * user — запись в user_methods = переопределение юзера.
 * unauthed — ортогональный модификатор: userId = null видит только их.
 * Методы с 0 эффективных типов в требования не попадают.
 */
@Injectable()
export class EffectiveMethodsResolverService {
  constructor(
    private readonly usersCrud: UsersCrudService,
    private readonly methodsCrud: MethodsCrudService,
    private readonly methodTypesCrud: MethodTypesCrudService,
    private readonly methodTagsCrud: MethodTagsCrudService,
    private readonly userMethodsCrud: UserMethodsCrudService,
    private readonly userMethodTypesCrud: UserMethodTypesCrudService,
    private readonly typesCrud: TypesCrudService,
    private readonly tagsCrud: TagsCrudService,
  ) {}

  async resolve(
    coreUserId: string | null,
    filterTags: string[] = [],
  ): Promise<MethodView[]> {
    const tags = await this.tagsCrud.findBy({});
    const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));
    const knownTagNames = new Set(tags.map((tag) => tag.name));
    for (const name of filterTags) {
      if (!knownTagNames.has(name)) {
        throw new TwoFaError(
          TwoFaErrorCode.UnknownTag,
          `Tag "${name}" does not exist`,
        );
      }
    }

    const methods = await this.methodsCrud.findBy({
      isActive: true,
      isDeleted: false,
    });
    if (methods.length === 0) {
      return [];
    }
    const methodIds = methods.map((method) => method.id);
    const [methodTypeRows, methodTagRows, types] = await Promise.all([
      this.methodTypesCrud.findBy({ methodId: In(methodIds) }),
      this.methodTagsCrud.findBy({ methodId: In(methodIds) }),
      this.typesCrud.findBy({ isActive: true, isDeleted: false }),
    ]);
    const typeNameById = new Map(types.map((type) => [type.id, type.type]));

    const overrides = await this.loadOverrides(coreUserId);

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

      // переопределение действует только в режиме user
      if (tagNames.includes(TAG_USER) && overrides) {
        const override = overrides.byMethodId.get(method.id);
        if (override) {
          typeNames = override.isActive
            ? (overrides.typeIdsByUserMethodId.get(override.id) ?? [])
                .map((typeId) => typeNameById.get(typeId))
                .filter((name): name is string => name !== undefined)
            : [];
        }
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

  private async loadOverrides(coreUserId: string | null): Promise<{
    byMethodId: Map<string, { id: string; isActive: boolean }>;
    typeIdsByUserMethodId: Map<string, string[]>;
  } | null> {
    if (coreUserId === null) {
      return null;
    }
    const [user] = await this.usersCrud.findBy({ userId: coreUserId });
    if (!user) {
      // юзер ещё не синхронизирован — переопределений нет, действует конфигурация методов
      return null;
    }
    const userMethods = await this.userMethodsCrud.findBy({
      userId: user.id,
      isDeleted: false,
    });
    if (userMethods.length === 0) {
      return { byMethodId: new Map(), typeIdsByUserMethodId: new Map() };
    }
    const typeRows = await this.userMethodTypesCrud.findBy({
      userMethodId: In(userMethods.map((userMethod) => userMethod.id)),
    });
    const typeIdsByUserMethodId = new Map<string, string[]>();
    for (const row of typeRows) {
      const list = typeIdsByUserMethodId.get(row.userMethodId) ?? [];
      list.push(row.typeId);
      typeIdsByUserMethodId.set(row.userMethodId, list);
    }
    return {
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
