import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MethodType } from '../entities';
import { CrudService } from './crud.service';

@Injectable()
export class MethodTypesCrudService extends CrudService<MethodType> {
  constructor(
    @InjectRepository(MethodType) repository: Repository<MethodType>,
  ) {
    super(repository);
  }
}
