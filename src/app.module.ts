import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { CryptoModule } from './crypto/crypto.module';
import { DatabaseModule } from './database/database.module';
import { buildDataSourceOptions } from './database/typeorm-options';
import { ScheduleModule } from '@nestjs/schedule';
import { MethodsModule } from './methods/methods.module';
import { OperationsModule } from './operations/operations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildDataSourceOptions(config.getOrThrow<string>('database.url')),
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    CryptoModule,
    MethodsModule,
    OperationsModule,
  ],
})
export class AppModule {}
