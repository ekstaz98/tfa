import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag } from '../entities';
import { CrudService } from './crud.service';

@Injectable()
export class TagsCrudService extends CrudService<Tag> {
  constructor(@InjectRepository(Tag) repository: Repository<Tag>) {
    super(repository);
  }
}
