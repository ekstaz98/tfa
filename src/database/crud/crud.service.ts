import {
  DeepPartial,
  EntityManager,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

interface HasId extends ObjectLiteral {
  id: string;
}

/**
 * Базовый CRUD-сервис: только персистентность, без бизнес-правил.
 * Каждый метод принимает опциональный EntityManager — доменный сервис
 * может выполнить несколько CRUD-вызовов в одной транзакции.
 */
export abstract class CrudService<T extends HasId> {
  protected constructor(private readonly _repository: Repository<T>) {}

  protected repo(manager?: EntityManager): Repository<T> {
    return manager
      ? manager.getRepository<T>(this._repository.target)
      : this._repository;
  }

  create(data: DeepPartial<T>, manager?: EntityManager): Promise<T> {
    const repo = this.repo(manager);
    return repo.save(repo.create(data));
  }

  /** Батч-вставка одним INSERT; пустой массив — no-op. */
  createMany(data: DeepPartial<T>[], manager?: EntityManager): Promise<T[]> {
    if (data.length === 0) {
      return Promise.resolve([]);
    }
    const repo = this.repo(manager);
    return repo.save(repo.create(data));
  }

  findById(id: string, manager?: EntityManager): Promise<T | null> {
    return this.repo(manager).findOneBy({
      id,
    } as FindOptionsWhere<T>);
  }

  findBy(
    criteria: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    manager?: EntityManager,
  ): Promise<T[]> {
    return this.repo(manager).findBy(criteria);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<T>,
    manager?: EntityManager,
  ): Promise<void> {
    await this.repo(manager).update(id, data);
  }

  /** Один UPDATE по списку id; пустой массив — no-op. */
  async updateMany(
    ids: string[],
    data: QueryDeepPartialEntity<T>,
    manager?: EntityManager,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.repo(manager).update(ids, data);
  }

  /** Жёсткое удаление — для junction-таблиц без is_deleted (дифф связей). */
  async delete(id: string, manager?: EntityManager): Promise<void> {
    await this.repo(manager).delete(id);
  }

  /** Один DELETE по списку id; пустой массив — no-op. */
  async deleteMany(ids: string[], manager?: EntityManager): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.repo(manager).delete(ids);
  }
}

interface HasSoftDelete extends HasId {
  isDeleted: boolean;
}

/** CRUD для сущностей с is_deleted. */
export abstract class SoftDeleteCrudService<
  T extends HasSoftDelete,
> extends CrudService<T> {
  async softDelete(id: string, manager?: EntityManager): Promise<void> {
    await this.update(
      id,
      { isDeleted: true } as unknown as QueryDeepPartialEntity<T>,
      manager,
    );
  }
}
