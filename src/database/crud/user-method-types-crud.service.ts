import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserMethodType } from '../entities';
import { CrudService } from './crud.service';

@Injectable()
export class UserMethodTypesCrudService extends CrudService<UserMethodType> {
  constructor(
    @InjectRepository(UserMethodType)
    repository: Repository<UserMethodType>,
  ) {
    super(repository);
  }
}
