import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Method } from '../entities';
import { SoftDeleteCrudService } from './crud.service';

@Injectable()
export class MethodsCrudService extends SoftDeleteCrudService<Method> {
  constructor(@InjectRepository(Method) repository: Repository<Method>) {
    super(repository);
  }
}
