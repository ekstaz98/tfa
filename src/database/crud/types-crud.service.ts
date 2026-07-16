import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Type } from '../entities';
import { SoftDeleteCrudService } from './crud.service';

@Injectable()
export class TypesCrudService extends SoftDeleteCrudService<Type> {
  constructor(@InjectRepository(Type) repository: Repository<Type>) {
    super(repository);
  }
}
