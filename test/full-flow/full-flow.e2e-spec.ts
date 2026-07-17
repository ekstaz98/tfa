import './e2e-env';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import * as amqplib from 'amqplib';
import { Client } from 'pg';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { UsersCrudService } from '../../src/database/crud';
import { buildDataSourceOptions } from '../../src/database/typeorm-options';
import { MockCodeSendPublisher } from '../../src/operations/services';
import { USER_SYNC_EVENT } from '../../src/users-sync/interfaces';

const DB_URL = process.env.DATABASE_URL as string;
const ADMIN_DB_URL = 'postgres://tfa:tfa@localhost:5432/postgres';
const RMQ_URL = 'amqp://tfa:tfa@localhost:5672';
const QUEUE = process.env.RMQ_USERS_QUEUE as string;

const CORE_USER = '55555555-5555-5555-5555-555555555555';
const PHONE_RAW = '+7 912 345-33-45';
const PHONE = '+79123453345';
const EMAIL_RAW = 'User@Mail.com';
const EMAIL = 'user@mail.com';

const ADMIN = { 'x-roles': 'admin' };
const SERVICE = { 'x-roles': 'service' };
const AUTHED = { 'x-user-id': CORE_USER };

interface GqlBody {
  data?: Record<string, any>;
  errors?: Array<{ message: string; code: string }>;
}

async function waitFor<T>(
  probe: () => Promise<T | null | undefined>,
  timeoutMs = 10_000,
): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const result = await probe();
    if (result) {
      return result;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('waitFor: timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Сквозной сценарий скелета (этап 8 плана): регистрация по незнакомому
 * identity → событие создания юзера из интегрирующей системы → signin по
 * identity с 2ФА → настройка юзера → transfer через verifyTwoFa.
 * Коды читаются из мок-реализации порта отправки — API чтения кодов нет.
 */
describe('Сквозной флоу 2ФА (e2e)', () => {
  let app: INestApplication;
  let publisher: MockCodeSendPublisher;
  let connection: amqplib.ChannelModel;
  let channel: amqplib.Channel;
  const methodIds: Record<string, string> = {};

  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_DB_URL });
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS tfa_e2e_flow WITH (FORCE)');
    await admin.query('CREATE DATABASE tfa_e2e_flow');
    await admin.end();

    const migrator = new DataSource(buildDataSourceOptions(DB_URL));
    await migrator.initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    const config = app.get(ConfigService);
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [config.getOrThrow<string>('rmq.url')],
        queue: QUEUE,
        noAck: false,
        queueOptions: { durable: true },
      },
    });
    await app.startAllMicroservices();
    await app.init();
    publisher = app.get(MockCodeSendPublisher);

    connection = await amqplib.connect(RMQ_URL);
    channel = await connection.createChannel();
    await channel.assertQueue(QUEUE, { durable: true });
  });

  afterAll(async () => {
    await channel?.close();
    await connection?.close();
    await app?.close();
  });

  async function gql(
    query: string,
    variables?: object,
    headers: Record<string, string> = {},
  ): Promise<GqlBody> {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set(headers)
      .send({ query, variables });
    return response.body as GqlBody;
  }

  function lastCodeFor(operationId: string): string {
    const event = [...publisher.events]
      .reverse()
      .find((candidate) => candidate.data.data.operationId === operationId);
    if (!event) {
      throw new Error(`no published code for operation ${operationId}`);
    }
    return event.data.data.code;
  }

  const SEND_TWO_FA = `mutation($input: SendTwoFaInput!) {
    sendTwoFa(input: $input) { operationId types { type identity expire retry } }
  }`;
  const VERIFY_TWO_FA = `mutation($input: VerifyTwoFaInput!) {
    verifyTwoFa(input: $input) { verified required userId identity }
  }`;

  it('0. админ настраивает методы: signup, signin, transfer', async () => {
    const body = await gql(
      `mutation($input: CreateMethodsInput!) {
        createTwoFaMethod(input: $input) { id method }
      }`,
      {
        input: {
          methods: [
            { method: 'signup', types: ['SMS'], tags: ['SYSTEM', 'UNAUTHED'] },
            { method: 'signin', types: ['EMAIL'], tags: ['UNAUTHED', 'USER'] },
            { method: 'transfer', types: ['SMS', 'EMAIL'], tags: ['USER'] },
          ],
        },
      },
      ADMIN,
    );
    expect(body.errors).toBeUndefined();
    for (const view of body.data!.createTwoFaMethod as Array<{
      id: string;
      method: string;
    }>) {
      methodIds[view.method] = view.id;
    }
  });

  it('1. регистрация: код на незнакомый номер, verify подтверждает владение каналом', async () => {
    const sendBody = await gql(
      SEND_TWO_FA,
      { input: { method: 'signup', identity: PHONE_RAW } },
      { 'x-client-ip': '10.1.1.1' },
    );
    expect(sendBody.errors).toBeUndefined();
    const operationId = sendBody.data!.sendTwoFa.operationId as string;
    expect(sendBody.data!.sendTwoFa.types[0].identity).toBe('+7912...3345');

    const verifyBody = await gql(
      VERIFY_TWO_FA,
      {
        input: {
          operationId,
          method: 'signup',
          codes: [{ type: 'sms', code: lastCodeFor(operationId) }],
        },
      },
      SERVICE,
    );
    expect(verifyBody.data!.verifyTwoFa).toEqual({
      verified: true,
      required: null,
      userId: null,
      identity: PHONE,
    });
  });

  it('2. core создаёт юзера и шлёт RMQ-событие — юзер и креды появляются в базе', async () => {
    channel.sendToQueue(
      QUEUE,
      Buffer.from(
        JSON.stringify({
          pattern: USER_SYNC_EVENT,
          data: {
            userId: CORE_USER,
            credentials: [
              { type: 'sms', identity: PHONE },
              { type: 'email', identity: EMAIL_RAW },
            ],
          },
        }),
      ),
    );

    const users = app.get(UsersCrudService);
    await waitFor(async () => {
      const [row] = await users.findBy({ userId: CORE_USER });
      return row;
    });
  });

  it('3. signin по identity: гейтвей узнаёт required и кто прошёл проверку', async () => {
    const required = await gql(
      VERIFY_TWO_FA,
      { input: { method: 'signin', identity: EMAIL } },
      SERVICE,
    );
    expect(required.data!.verifyTwoFa.required).toBe(true);

    const sendBody = await gql(SEND_TWO_FA, {
      input: { method: 'signin', identity: ` ${EMAIL_RAW} ` },
    });
    expect(sendBody.errors).toBeUndefined();
    const operationId = sendBody.data!.sendTwoFa.operationId as string;
    expect(sendBody.data!.sendTwoFa.types).toEqual([
      { type: 'email', identity: 'u...r@mail.com', expire: 300, retry: 120 },
    ]);

    const verifyBody = await gql(
      VERIFY_TWO_FA,
      {
        input: {
          operationId,
          method: 'signin',
          codes: [{ type: 'email', code: lastCodeFor(operationId) }],
        },
      },
      SERVICE,
    );
    // гейтвею для логина нужно знать, кто прошёл проверку
    expect(verifyBody.data!.verifyTwoFa).toEqual({
      verified: true,
      required: null,
      userId: CORE_USER,
      identity: EMAIL,
    });
  });

  it('4. юзер сужает transfer до email через updateMyTwoFaMethod', async () => {
    const body = await gql(
      `mutation($input: UpdateMyMethodsInput!) {
        updateMyTwoFaMethod(input: $input) { id method isActive types tags }
      }`,
      { input: { methods: [{ id: methodIds.transfer, types: ['email'] }] } },
      AUTHED,
    );
    expect(body.errors).toBeUndefined();
    expect(body.data!.updateMyTwoFaMethod[0].types).toEqual(['email']);

    const methods = await gql(
      `{ twoFaMethods { methods { method types } } }`,
      undefined,
      AUTHED,
    );
    const transfer = (
      methods.data!.twoFaMethods.methods as Array<{
        method: string;
        types: string[];
      }>
    ).find((view) => view.method === 'transfer');
    expect(transfer?.types).toEqual(['email']);
  });

  it('5. transfer: required → sendTwoFa по настройкам юзера → verifyTwoFa', async () => {
    const required = await gql(
      VERIFY_TWO_FA,
      { input: { method: 'transfer', userId: CORE_USER } },
      SERVICE,
    );
    expect(required.data!.verifyTwoFa.required).toBe(true);

    const sendBody = await gql(
      SEND_TWO_FA,
      { input: { method: 'transfer' } },
      AUTHED,
    );
    expect(sendBody.errors).toBeUndefined();
    const operationId = sendBody.data!.sendTwoFa.operationId as string;
    // после переопределения — один email-код, не sms+email
    expect(sendBody.data!.sendTwoFa.types).toEqual([
      { type: 'email', identity: 'u...r@mail.com', expire: 300, retry: 120 },
    ]);

    const verifyBody = await gql(
      VERIFY_TWO_FA,
      {
        input: {
          operationId,
          method: 'transfer',
          userId: CORE_USER,
          codes: [{ type: 'email', code: lastCodeFor(operationId) }],
        },
      },
      SERVICE,
    );
    expect(verifyBody.data!.verifyTwoFa.verified).toBe(true);
  });
});
