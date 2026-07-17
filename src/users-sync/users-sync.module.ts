import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { OperationsModule } from '../operations/operations.module';
import { UsersSyncController } from './users-sync.controller';
import { UsersSyncService } from './services';

@Module({
  imports: [DatabaseModule, OperationsModule],
  controllers: [UsersSyncController],
  providers: [UsersSyncService],
  exports: [UsersSyncService],
})
export class UsersSyncModule {}
