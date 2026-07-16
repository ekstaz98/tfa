import { join } from 'path';
import { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

/**
 * Общие опции для приложения (TypeOrmModule) и CLI (data-source.ts).
 * Схема управляется только миграциями: synchronize всегда false.
 */
export function buildDataSourceOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: [join(__dirname, '..', '**', '*.entity{.ts,.js}')],
    migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
    namingStrategy: new SnakeNamingStrategy(),
    // uuid PK через gen_random_uuid() (pgcrypto), не uuid-ossp
    uuidExtension: 'pgcrypto',
    synchronize: false,
    logging: false,
  };
}
