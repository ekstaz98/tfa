import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MethodTag } from '../entities';
import { CrudService } from './crud.service';

@Injectable()
export class MethodTagsCrudService extends CrudService<MethodTag> {
  constructor(@InjectRepository(MethodTag) repository: Repository<MethodTag>) {
    super(repository);
  }
}
