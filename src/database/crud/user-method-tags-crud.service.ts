import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserMethodTag } from '../entities';
import { CrudService } from './crud.service';

@Injectable()
export class UserMethodTagsCrudService extends CrudService<UserMethodTag> {
  constructor(
    @InjectRepository(UserMethodTag)
    repository: Repository<UserMethodTag>,
  ) {
    super(repository);
  }
}
