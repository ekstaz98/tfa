import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import {
  MethodTagsCrudService,
  MethodTypesCrudService,
  TagsCrudService,
  TypesCrudService,
} from '../../database/crud';
import { Method } from '../../database/entities';
import { MethodView } from '../interfaces';

/** Сборка представлений методов (формат 2faMethods) из связей и справочников. */
@Injectable()
export class MethodViewsService {
  constructor(
    private readonly methodTypesCrud: MethodTypesCrudService,
    private readonly methodTagsCrud: MethodTagsCrudService,
    private readonly typesCrud: TypesCrudService,
    private readonly tagsCrud: TagsCrudService,
  ) {}

  async buildViews(
    methods: Method[],
    manager?: EntityManager,
  ): Promise<MethodView[]> {
    if (methods.length === 0) {
      return [];
    }
    const methodIds = methods.map((method) => method.id);
    const [typeRows, tagRows, types, tags] = await Promise.all([
      this.methodTypesCrud.findBy({ methodId: In(methodIds) }, manager),
      this.methodTagsCrud.findBy({ methodId: In(methodIds) }, manager),
      this.typesCrud.findBy({}, manager),
      this.tagsCrud.findBy({}, manager),
    ]);
    const typeNameById = new Map(types.map((type) => [type.id, type.type]));
    const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));

    return methods.map((method) => ({
      id: method.id,
      method: method.method,
      isActive: method.isActive,
      isDeleted: method.isDeleted,
      types: typeRows
        .filter((row) => row.methodId === method.id)
        .map((row) => typeNameById.get(row.typeId) as string)
        .sort(),
      tags: tagRows
        .filter((row) => row.methodId === method.id)
        .map((row) => tagNameById.get(row.tagId) as string)
        .sort(),
    }));
  }
}
