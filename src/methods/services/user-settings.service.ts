import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  MethodTagsCrudService,
  MethodTypesCrudService,
  MethodsCrudService,
  TagsCrudService,
  TypesCrudService,
  UserCredentialsCrudService,
  UserMethodTypesCrudService,
  UserMethodsCrudService,
  UsersCrudService,
} from '../../database/crud';
import { Method, User, UserMethod } from '../../database/entities';
import { TwoFaError, TwoFaErrorCode } from '../../errors';
import { TAG_USER, TOTP_TYPE } from '../constants';
import { MethodView, UpdateMyMethodInput } from '../interfaces';

/**
 * updateMy2faMethod: переопределение методов юзером. Разрешено только
 * для методов с тегом user; типы — подмножество типов метода; для каждого
 * выбранного типа обязан быть подтверждённый активный кред (для ga — с
 * секретом) — юзер не может запереть сам себя настройкой. Сюда же входит
 * вкл/выкл типов (бывший toggle2faForUser) — отдельного toggle нет.
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
    private readonly _typesCrud: TypesCrudService,
    private readonly _tagsCrud: TagsCrudService,
  ) {}

  async updateMyMethods(
    coreUserId: string,
    inputs: UpdateMyMethodInput[],
  ): Promise<MethodView[]> {
    const [user] = await this._usersCrud.findBy({ userId: coreUserId });
    if (!user) {
      throw new TwoFaError(
        TwoFaErrorCode.IdentityNotFound,
        'User is not synchronized with 2FA service',
      );
    }
    const [types, tags] = await Promise.all([
      this._typesCrud.findBy({ isActive: true, isDeleted: false }),
      this._tagsCrud.findBy({}),
    ]);
    const typeByName = new Map(types.map((type) => [type.type, type]));
    const typeNameById = new Map(types.map((type) => [type.id, type.type]));
    const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));

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
    for (const typeId of typeIds) {
      const typeName = context.typeNameById.get(typeId) as string;
      const [credential] = await this._userCredentialsCrud.findBy(
        {
          userId: user.id,
          typeId,
          isConfirmed: true,
          isActive: true,
          isDeleted: false,
        },
        context.manager,
      );
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
    const existing = new Set<string>();
    for (const row of current) {
      if (!target.has(row.typeId)) {
        await this._userMethodTypesCrud.delete(row.id, manager);
      } else {
        existing.add(row.typeId);
      }
    }
    for (const typeId of target) {
      if (!existing.has(typeId)) {
        await this._userMethodTypesCrud.create(
          { userMethodId, typeId },
          manager,
        );
      }
    }
  }
}
