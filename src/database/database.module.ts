import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Code,
  Method,
  MethodTag,
  MethodType,
  Operation,
  Tag,
  Type,
  User,
  UserCredential,
  UserMethod,
  UserMethodTag,
  UserMethodType,
} from './entities';
import {
  CodesCrudService,
  MethodTagsCrudService,
  MethodTypesCrudService,
  MethodsCrudService,
  OperationsCrudService,
  TagsCrudService,
  TypesCrudService,
  UserCredentialsCrudService,
  UserMethodTagsCrudService,
  UserMethodTypesCrudService,
  UserMethodsCrudService,
  UsersCrudService,
} from './crud';

const CRUD_SERVICES = [
  TypesCrudService,
  TagsCrudService,
  MethodsCrudService,
  MethodTypesCrudService,
  MethodTagsCrudService,
  UsersCrudService,
  UserCredentialsCrudService,
  UserMethodsCrudService,
  UserMethodTypesCrudService,
  UserMethodTagsCrudService,
  OperationsCrudService,
  CodesCrudService,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Type,
      Tag,
      Method,
      MethodType,
      MethodTag,
      User,
      UserCredential,
      UserMethod,
      UserMethodType,
      UserMethodTag,
      Operation,
      Code,
    ]),
  ],
  providers: CRUD_SERVICES,
  exports: CRUD_SERVICES,
})
export class DatabaseModule {}
