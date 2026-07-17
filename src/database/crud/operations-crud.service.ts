import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { Operation, OperationStatus } from '../entities';
import { CrudService } from './crud.service';

/**
 * Помимо базового контракта — персистентные примитивы конкурентности
 * (verify под SELECT FOR UPDATE, переходы статусов условным UPDATE)
 * и батч-DELETE retention. Бизнес-правил здесь нет.
 */
@Injectable()
export class OperationsCrudService extends CrudService<Operation> {
  constructor(@InjectRepository(Operation) repository: Repository<Operation>) {
    super(repository);
  }

  /** COUNT(*) по критериям — для лимитов, где сами строки не нужны. */
  countBy(
    criteria: FindOptionsWhere<Operation>,
    manager?: EntityManager,
  ): Promise<number> {
    return this.repo(manager).countBy(criteria);
  }

  findByIdForUpdate(
    id: string,
    manager?: EntityManager,
  ): Promise<Operation | null> {
    return this.repo(manager).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Переход статуса условным UPDATE: true, если строка была в статусе from. */
  async updateStatusIf(
    id: string,
    from: OperationStatus,
    to: OperationStatus,
    manager?: EntityManager,
  ): Promise<boolean> {
    const result = await this.repo(manager).update(
      { id, status: from },
      { status: to },
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * Батч-DELETE завершённых/истёкших операций старше cutoff одним запросом;
   * их codes уходят по FK ON DELETE CASCADE. Живые pending не трогаются.
   */
  async deleteFinishedBefore(
    cutoff: Date,
    manager?: EntityManager,
  ): Promise<number> {
    const result = await this.repo(manager)
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoff', { cutoff })
      .andWhere('(status != :pending OR expires_at < NOW())', {
        pending: OperationStatus.Pending,
      })
      .execute();
    return result.affected ?? 0;
  }
}
