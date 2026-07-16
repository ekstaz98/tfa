import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  MethodTagsCrudService,
  MethodTypesCrudService,
  MethodsCrudService,
  TagsCrudService,
  TypesCrudService,
} from '../../database/crud';
import { Method } from '../../database/entities';
import { TwoFaError, TwoFaErrorCode } from '../../errors';
import { MODE_TAGS, TAG_SYSTEM } from '../constants';
import {
  CreateMethodInput,
  MethodView,
  UpdateMethodInput,
} from '../interfaces';
import { MethodViewsService } from './method-views.service';

interface Dictionaries {
  typeIdByName: Map<string, string>;
  tagIdByName: Map<string, string>;
  tagNameById: Map<string, string>;
}

/** create2faMethod / update2faMethod — конфигурация методов админом. */
@Injectable()
export class MethodsAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly methodsCrud: MethodsCrudService,
    private readonly methodTypesCrud: MethodTypesCrudService,
    private readonly methodTagsCrud: MethodTagsCrudService,
    private readonly typesCrud: TypesCrudService,
    private readonly tagsCrud: TagsCrudService,
    private readonly methodViews: MethodViewsService,
  ) {}

  async createMethods(inputs: CreateMethodInput[]): Promise<MethodView[]> {
    const dictionaries = await this.loadDictionaries();

    const seen = new Set<string>();
    for (const input of inputs) {
      if (seen.has(input.method)) {
        throw new TwoFaError(
          TwoFaErrorCode.MethodAlreadyExists,
          `Method "${input.method}" is duplicated in the request`,
        );
      }
      seen.add(input.method);
      this.resolveTagIds(input.tags, dictionaries);
      this.resolveTypeIds(input.types, dictionaries);
    }

    const duplicates = await this.methodsCrud.findBy({
      method: In(inputs.map((input) => input.method)),
      isDeleted: false,
    });
    if (duplicates.length > 0) {
      throw new TwoFaError(
        TwoFaErrorCode.MethodAlreadyExists,
        `Method "${duplicates[0].method}" already exists and is not deleted`,
      );
    }

    const created = await this.dataSource.transaction(async (manager) => {
      const methods: Method[] = [];
      for (const input of inputs) {
        const method = await this.methodsCrud.create(
          { method: input.method, isActive: input.isActive ?? true },
          manager,
        );
        await this.replaceLinks(
          method.id,
          this.resolveTypeIds(input.types, dictionaries),
          this.resolveTagIds(input.tags, dictionaries),
          manager,
        );
        methods.push(method);
      }
      return methods;
    });
    return this.methodViews.buildViews(created);
  }

  async updateMethods(inputs: UpdateMethodInput[]): Promise<MethodView[]> {
    const dictionaries = await this.loadDictionaries();

    const updated = await this.dataSource.transaction(async (manager) => {
      const methods: Method[] = [];
      for (const input of inputs) {
        methods.push(await this.updateOne(input, dictionaries, manager));
      }
      return methods;
    });
    return this.methodViews.buildViews(updated);
  }

  private async updateOne(
    input: UpdateMethodInput,
    dictionaries: Dictionaries,
    manager: EntityManager,
  ): Promise<Method> {
    const method = await this.methodsCrud.findById(input.id, manager);
    if (!method) {
      throw new TwoFaError(
        TwoFaErrorCode.UnknownMethod,
        `Method with id "${input.id}" does not exist`,
      );
    }

    // guard системных методов: пока висит тег system — метод не выключить,
    // не удалить и не лишить типов; снятие тега — отдельное действие.
    const currentTagRows = await this.methodTagsCrud.findBy(
      { methodId: method.id },
      manager,
    );
    const currentTagNames = currentTagRows.map(
      (row) => dictionaries.tagNameById.get(row.tagId) as string,
    );
    if (
      currentTagNames.includes(TAG_SYSTEM) &&
      (input.isActive === false ||
        input.isDeleted === true ||
        (input.types !== undefined && input.types.length === 0))
    ) {
      throw new TwoFaError(TwoFaErrorCode.SystemMethodLocked);
    }

    // переименование / восстановление не должны создать дубль среди неудалённых
    const targetName = input.method ?? method.method;
    const becomesVisible =
      input.isDeleted === false ||
      (!method.isDeleted && input.isDeleted !== true);
    if (becomesVisible && (input.method || input.isDeleted === false)) {
      const duplicates = await this.methodsCrud.findBy(
        { method: targetName, isDeleted: false },
        manager,
      );
      if (duplicates.some((duplicate) => duplicate.id !== method.id)) {
        throw new TwoFaError(
          TwoFaErrorCode.MethodAlreadyExists,
          `Method "${targetName}" already exists and is not deleted`,
        );
      }
    }

    const typeIds = input.types
      ? this.resolveTypeIds(input.types, dictionaries)
      : undefined;
    const tagIds = input.tags
      ? this.resolveTagIds(input.tags, dictionaries)
      : undefined;

    await this.methodsCrud.update(
      method.id,
      {
        ...(input.method !== undefined ? { method: input.method } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isDeleted !== undefined
          ? { isDeleted: input.isDeleted }
          : {}),
      },
      manager,
    );

    if (typeIds) {
      await this.diffLinks(
        this.methodTypesCrud,
        method.id,
        'typeId',
        typeIds,
        manager,
      );
    }
    if (tagIds) {
      await this.diffLinks(
        this.methodTagsCrud,
        method.id,
        'tagId',
        tagIds,
        manager,
      );
    }

    return (await this.methodsCrud.findById(method.id, manager)) as Method;
  }

  private async loadDictionaries(): Promise<Dictionaries> {
    const [types, tags] = await Promise.all([
      this.typesCrud.findBy({ isActive: true, isDeleted: false }),
      this.tagsCrud.findBy({ isActive: true }),
    ]);
    return {
      typeIdByName: new Map(types.map((type) => [type.type, type.id])),
      tagIdByName: new Map(tags.map((tag) => [tag.name, tag.id])),
      tagNameById: new Map(tags.map((tag) => [tag.id, tag.name])),
    };
  }

  private resolveTypeIds(
    names: string[],
    dictionaries: Dictionaries,
  ): string[] {
    return [...new Set(names)].map((name) => {
      const id = dictionaries.typeIdByName.get(name);
      if (!id) {
        throw new TwoFaError(
          TwoFaErrorCode.UnknownType,
          `Type "${name}" does not exist`,
        );
      }
      return id;
    });
  }

  private resolveTagIds(names: string[], dictionaries: Dictionaries): string[] {
    const unique = [...new Set(names)];
    const modeTags = unique.filter((name) => MODE_TAGS.includes(name));
    if (modeTags.length > 1) {
      throw new TwoFaError(
        TwoFaErrorCode.ModeTagsConflict,
        `Method can have at most one mode tag, got: ${modeTags.join(', ')}`,
      );
    }
    return unique.map((name) => {
      const id = dictionaries.tagIdByName.get(name);
      if (!id) {
        throw new TwoFaError(
          TwoFaErrorCode.UnknownTag,
          `Tag "${name}" does not exist`,
        );
      }
      return id;
    });
  }

  private async replaceLinks(
    methodId: string,
    typeIds: string[],
    tagIds: string[],
    manager: EntityManager,
  ): Promise<void> {
    for (const typeId of typeIds) {
      await this.methodTypesCrud.create({ methodId, typeId }, manager);
    }
    for (const tagId of tagIds) {
      await this.methodTagsCrud.create({ methodId, tagId }, manager);
    }
  }

  /** Связи меняются диффом: лишние строки удаляются, недостающие создаются. */
  private async diffLinks(
    crud: MethodTypesCrudService | MethodTagsCrudService,
    methodId: string,
    fkField: 'typeId' | 'tagId',
    targetIds: string[],
    manager: EntityManager,
  ): Promise<void> {
    const current = await crud.findBy({ methodId }, manager);
    const target = new Set(targetIds);
    const existing = new Set<string>();
    for (const row of current as unknown as Array<Record<string, string>>) {
      if (!target.has(row[fkField])) {
        await crud.delete(row.id, manager);
      } else {
        existing.add(row[fkField]);
      }
    }
    for (const id of target) {
      if (!existing.has(id)) {
        await crud.create({ methodId, [fkField]: id }, manager);
      }
    }
  }
}
