import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Code } from '../entities';
import { CrudService } from './crud.service';

@Injectable()
export class CodesCrudService extends CrudService<Code> {
  constructor(@InjectRepository(Code) repository: Repository<Code>) {
    super(repository);
  }

  /** Проставляет verified_at всем кодам операции одним UPDATE. */
  async markVerified(
    operationId: string,
    verifiedAt: Date,
    manager?: EntityManager,
  ): Promise<void> {
    await this.repo(manager).update({ operationId }, { verifiedAt });
  }

  /** Атомарный SET attempts = attempts + 1; возвращает новое значение. */
  async incrementAttempts(
    id: string,
    manager?: EntityManager,
  ): Promise<number> {
    const result = await this.repo(manager)
      .createQueryBuilder()
      .update()
      .set({ attempts: () => 'attempts + 1' })
      .where('id = :id', { id })
      .returning('attempts')
      .execute();
    return Number((result.raw as Array<{ attempts: number }>)[0].attempts);
  }
}
