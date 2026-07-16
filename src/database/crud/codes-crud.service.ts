import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Code } from '../entities';
import { CrudService } from './crud.service';

@Injectable()
export class CodesCrudService extends CrudService<Code> {
  constructor(@InjectRepository(Code) repository: Repository<Code>) {
    super(repository);
  }
}
