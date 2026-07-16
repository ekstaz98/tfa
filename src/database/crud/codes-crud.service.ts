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
