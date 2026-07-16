import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserMethod } from '../entities';
import { SoftDeleteCrudService } from './crud.service';

@Injectable()
export class UserMethodsCrudService extends SoftDeleteCrudService<UserMethod> {
  constructor(
    @InjectRepository(UserMethod) repository: Repository<UserMethod>,
  ) {
    super(repository);
  }
}
