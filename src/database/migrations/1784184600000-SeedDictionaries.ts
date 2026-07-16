import { MigrationInterface, QueryRunner } from 'typeorm';

const TAGS = ['unauthed', 'user', 'system', 'default'];
const TYPES = ['sms', 'email', 'push', 'ga'];

/** Сид справочников. Методы сюда не входят — они заводятся админ-мутацией или автосинком. */
export class SeedDictionaries1784184600000 implements MigrationInterface {
  name = 'SeedDictionaries1784184600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of TAGS) {
      await queryRunner.query(
        `INSERT INTO "tags" ("name") VALUES ($1) ON CONFLICT ("name") DO NOTHING`,
        [name],
      );
    }
    for (const type of TYPES) {
      await queryRunner.query(
        `INSERT INTO "types" ("type") VALUES ($1) ON CONFLICT ("type") DO NOTHING`,
        [type],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "tags" WHERE "name" = ANY($1::varchar[])`,
      [TAGS],
    );
    await queryRunner.query(
      `DELETE FROM "types" WHERE "type" = ANY($1::varchar[])`,
      [TYPES],
    );
  }
}
