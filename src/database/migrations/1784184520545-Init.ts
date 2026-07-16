import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1784184520545 implements MigrationInterface {
  name = 'Init1784184520545';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_96aac72f1574b88752e9fb00089" UNIQUE ("user_id"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "methods" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "method" character varying NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "is_deleted" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bd1e1f74f71be00abd0d2bc7c33" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_methods_method" ON "methods" ("method") WHERE "is_deleted" = false`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_methods" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "method_id" uuid NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "is_deleted" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cd29e2fd9e6c9f4ba3d64bf74e0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_user_methods_user_method" ON "user_methods" ("user_id", "method_id") WHERE "is_deleted" = false`,
    );
    await queryRunner.query(
      `CREATE TABLE "types" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "type" character varying NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "is_deleted" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_afb402d5bffe44480bc22efca06" UNIQUE ("type"), CONSTRAINT "PK_33b81de5358589c738907c3559b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_method_types" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_method_id" uuid NOT NULL, "type_id" uuid NOT NULL, CONSTRAINT "UQ_7972a0bdca17aa4adf4de1ead02" UNIQUE ("user_method_id", "type_id"), CONSTRAINT "PK_731bf4e117bdefcc14749eba2f1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tags" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d90243459a697eadb8ad56e9092" UNIQUE ("name"), CONSTRAINT "PK_e7dc17249a1148a1970748eda99" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."operation_status" AS ENUM('pending', 'verified', 'expired', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "operations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid, "method_id" uuid NOT NULL, "identity" character varying, "payload_hash" character varying, "status" "public"."operation_status" NOT NULL DEFAULT 'pending', "client_ip" character varying, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7b62d84d6f9912b975987165856" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f5a1b55fab5b0b77aff4a46eae" ON "operations" ("client_ip", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff830a139d95cc7918c570dba7" ON "operations" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5d9449ec861090e495386ae6f" ON "operations" ("identity", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "method_types" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "method_id" uuid NOT NULL, "type_id" uuid NOT NULL, CONSTRAINT "UQ_e4b53ba2bdba059fce3cd9cbaa6" UNIQUE ("method_id", "type_id"), CONSTRAINT "PK_eda4376b648f7207145d6c12390" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "method_tags" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "method_id" uuid NOT NULL, "tag_id" uuid NOT NULL, CONSTRAINT "UQ_9a841e9082f17de6b9d29ccf174" UNIQUE ("method_id", "tag_id"), CONSTRAINT "PK_25561d967fff289cb7e9c0f1870" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_credentials" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "type_id" uuid NOT NULL, "identity" character varying NOT NULL, "secret" character varying, "is_confirmed" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "is_deleted" boolean NOT NULL DEFAULT false, "last_used_counter" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5cadc04d03e2d9fe76e1b44eb34" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_user_credentials_user_type" ON "user_credentials" ("user_id", "type_id") WHERE "is_deleted" = false`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_user_credentials_type_identity" ON "user_credentials" ("type_id", "identity") WHERE "is_deleted" = false`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_method_tags" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_method_id" uuid NOT NULL, "tag_id" uuid NOT NULL, CONSTRAINT "UQ_5b0f1627882a1f1a17025127700" UNIQUE ("user_method_id", "tag_id"), CONSTRAINT "PK_a75b1461006c685f6cc785e72f5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "codes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "operation_id" uuid NOT NULL, "type_id" uuid NOT NULL, "code_hash" character varying, "attempts" integer NOT NULL DEFAULT '0', "sends_count" integer NOT NULL DEFAULT '1', "last_sent_at" TIMESTAMP WITH TIME ZONE, "verified_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_aff6461f96b7c2bfb24a22eb5aa" UNIQUE ("operation_id", "type_id"), CONSTRAINT "PK_9b85c624e2d705f4e8a9b64dbf4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_methods" ADD CONSTRAINT "FK_4adfae0355f751307f699736ba2" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_methods" ADD CONSTRAINT "FK_a3f8a1534a16f33c76520c0d1dd" FOREIGN KEY ("method_id") REFERENCES "methods"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_method_types" ADD CONSTRAINT "FK_cd045544fda9b408fdb180eb06e" FOREIGN KEY ("user_method_id") REFERENCES "user_methods"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_method_types" ADD CONSTRAINT "FK_69dc69c5cbc18bf2bd4213c6867" FOREIGN KEY ("type_id") REFERENCES "types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "operations" ADD CONSTRAINT "FK_140d3d8fe7db297a0ca81ca7949" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "operations" ADD CONSTRAINT "FK_9ae722c50576aa7e2516c0b471c" FOREIGN KEY ("method_id") REFERENCES "methods"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "method_types" ADD CONSTRAINT "FK_369a18929344f81b698efdcfb4a" FOREIGN KEY ("method_id") REFERENCES "methods"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "method_types" ADD CONSTRAINT "FK_6ae258c4265f59d34bd71dd964a" FOREIGN KEY ("type_id") REFERENCES "types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "method_tags" ADD CONSTRAINT "FK_f6da15d8a8a465ea5815fd2a1bc" FOREIGN KEY ("method_id") REFERENCES "methods"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "method_tags" ADD CONSTRAINT "FK_a379d6dd342c901ba1e4738e739" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_credentials" ADD CONSTRAINT "FK_dd0918407944553611bb3eb3ddc" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_credentials" ADD CONSTRAINT "FK_8b8dba9e167938268bd85ca8f36" FOREIGN KEY ("type_id") REFERENCES "types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_method_tags" ADD CONSTRAINT "FK_bbf1a7cccbf9455706a087fce36" FOREIGN KEY ("user_method_id") REFERENCES "user_methods"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_method_tags" ADD CONSTRAINT "FK_8a84726a7e2a3786f6473830ec7" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "codes" ADD CONSTRAINT "FK_39ef84075f26daae362141382be" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "codes" ADD CONSTRAINT "FK_6e8c649f891d27f6cf1d4c3eb77" FOREIGN KEY ("type_id") REFERENCES "types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "codes" DROP CONSTRAINT "FK_6e8c649f891d27f6cf1d4c3eb77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "codes" DROP CONSTRAINT "FK_39ef84075f26daae362141382be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_method_tags" DROP CONSTRAINT "FK_8a84726a7e2a3786f6473830ec7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_method_tags" DROP CONSTRAINT "FK_bbf1a7cccbf9455706a087fce36"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_credentials" DROP CONSTRAINT "FK_8b8dba9e167938268bd85ca8f36"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_credentials" DROP CONSTRAINT "FK_dd0918407944553611bb3eb3ddc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "method_tags" DROP CONSTRAINT "FK_a379d6dd342c901ba1e4738e739"`,
    );
    await queryRunner.query(
      `ALTER TABLE "method_tags" DROP CONSTRAINT "FK_f6da15d8a8a465ea5815fd2a1bc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "method_types" DROP CONSTRAINT "FK_6ae258c4265f59d34bd71dd964a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "method_types" DROP CONSTRAINT "FK_369a18929344f81b698efdcfb4a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "operations" DROP CONSTRAINT "FK_9ae722c50576aa7e2516c0b471c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "operations" DROP CONSTRAINT "FK_140d3d8fe7db297a0ca81ca7949"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_method_types" DROP CONSTRAINT "FK_69dc69c5cbc18bf2bd4213c6867"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_method_types" DROP CONSTRAINT "FK_cd045544fda9b408fdb180eb06e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_methods" DROP CONSTRAINT "FK_a3f8a1534a16f33c76520c0d1dd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_methods" DROP CONSTRAINT "FK_4adfae0355f751307f699736ba2"`,
    );
    await queryRunner.query(`DROP TABLE "codes"`);
    await queryRunner.query(`DROP TABLE "user_method_tags"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_user_credentials_type_identity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_user_credentials_user_type"`,
    );
    await queryRunner.query(`DROP TABLE "user_credentials"`);
    await queryRunner.query(`DROP TABLE "method_tags"`);
    await queryRunner.query(`DROP TABLE "method_types"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5d9449ec861090e495386ae6f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff830a139d95cc7918c570dba7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5a1b55fab5b0b77aff4a46eae"`,
    );
    await queryRunner.query(`DROP TABLE "operations"`);
    await queryRunner.query(`DROP TYPE "public"."operation_status"`);
    await queryRunner.query(`DROP TABLE "tags"`);
    await queryRunner.query(`DROP TABLE "user_method_types"`);
    await queryRunner.query(`DROP TABLE "types"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_user_methods_user_method"`,
    );
    await queryRunner.query(`DROP TABLE "user_methods"`);
    await queryRunner.query(`DROP INDEX "public"."uq_methods_method"`);
    await queryRunner.query(`DROP TABLE "methods"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
