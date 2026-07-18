import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserDefaultMethodsEnabled1784397859184 implements MigrationInterface {
  name = 'UserDefaultMethodsEnabled1784397859184';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "default_methods_enabled" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "default_methods_enabled"`,
    );
  }
}
