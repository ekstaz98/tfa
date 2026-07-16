import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Operation } from '../entities';
import { CrudService } from './crud.service';

@Injectable()
export class OperationsCrudService extends CrudService<Operation> {
  constructor(@InjectRepository(Operation) repository: Repository<Operation>) {
    super(repository);
  }
}
