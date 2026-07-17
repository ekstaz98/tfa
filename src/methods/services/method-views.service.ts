import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import {
  MethodTagsCrudService,
  MethodTypesCrudService,
} from '../../database/crud';
import { DictionaryCacheService } from '../../database/services';
import { Method } from '../../database/entities';
import { MethodView } from '../interfaces';

/** Сборка представлений методов (формат twoFaMethods) из связей и справочников. */
@Injectable()
export class MethodViewsService {
  constructor(
    private readonly _methodTypesCrud: MethodTypesCrudService,
    private readonly _methodTagsCrud: MethodTagsCrudService,
    private readonly _dictionaryCache: DictionaryCacheService,
  ) {}

  async buildViews(
    methods: Method[],
    manager?: EntityManager,
  ): Promise<MethodView[]> {
    if (methods.length === 0) {
      return [];
    }
    const methodIds = methods.map((method) => method.id);
    const [typeRows, tagRows, { typeNameById, tagNameById }] =
      await Promise.all([
        this._methodTypesCrud.findBy({ methodId: In(methodIds) }, manager),
        this._methodTagsCrud.findBy({ methodId: In(methodIds) }, manager),
        this._dictionaryCache.get(),
      ]);

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
