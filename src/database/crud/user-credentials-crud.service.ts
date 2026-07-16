import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserCredential } from '../entities';
import { SoftDeleteCrudService } from './crud.service';

@Injectable()
export class UserCredentialsCrudService extends SoftDeleteCrudService<UserCredential> {
  constructor(
    @InjectRepository(UserCredential)
    repository: Repository<UserCredential>,
  ) {
    super(repository);
  }
}
