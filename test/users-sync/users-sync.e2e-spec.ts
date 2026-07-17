import './e2e-env';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import * as amqplib from 'amqplib';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import {
  UserCredentialsCrudService,
  UsersCrudService,
} from '../../src/database/crud';
import { buildDataSourceOptions } from '../../src/database/typeorm-options';
import { USER_SYNC_EVENT } from '../../src/users-sync/interfaces';

const DB_URL = process.env.DATABASE_URL as string;
const ADMIN_DB_URL = 'postgres://tfa:tfa@localhost:5432/postgres';
const RMQ_URL = 'amqp://tfa:tfa@localhost:5672';
const QUEUE = process.env.RMQ_USERS_QUEUE as string;
const CORE_USER = '33333333-3333-3333-3333-333333333333';

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

describe('Синхронизация юзеров из RMQ (e2e)', () => {
  let app: INestApplication;
  let connection: amqplib.ChannelModel;
  let channel: amqplib.Channel;
  let users: UsersCrudService;
  let credentials: UserCredentialsCrudService;

  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_DB_URL });
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS tfa_e2e_rmq WITH (FORCE)');
    await admin.query('CREATE DATABASE tfa_e2e_rmq');
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

    users = app.get(UsersCrudService);
    credentials = app.get(UserCredentialsCrudService);

    connection = await amqplib.connect(RMQ_URL);
    channel = await connection.createChannel();
    await channel.assertQueue(QUEUE, { durable: true });
  });

  afterAll(async () => {
    await channel?.close();
    await connection?.close();
    await app?.close();
  });

  function publish(event: object): void {
    channel.sendToQueue(
      QUEUE,
      Buffer.from(JSON.stringify({ pattern: USER_SYNC_EVENT, data: event })),
    );
  }

  it('событие в очередь → юзер и подтверждённые креды в базе', async () => {
    publish({
      userId: CORE_USER,
      credentials: [
        { type: 'email', identity: ' A@B.com ' },
        { type: 'sms', identity: '8 (912) 345-33-45' },
      ],
    });

    const user = await waitFor(async () => {
      const [row] = await users.findBy({ userId: CORE_USER });
      return row;
    });
    const rows = await waitFor(async () => {
      const found = await credentials.findBy({
        userId: user.id,
        isDeleted: false,
      });
      return found.length === 2 ? found : null;
    });
    // ненормализованный identity из события находится по нормализованному поиску
    expect(rows.map((row) => row.identity).sort()).toEqual([
      '+89123453345',
      'a@b.com',
    ]);
    expect(rows.every((row) => row.isConfirmed && row.isActive)).toBe(true);
  });

  it('повторная доставка того же события не создаёт дублей', async () => {
    publish({
      userId: CORE_USER,
      credentials: [{ type: 'email', identity: 'a@b.com' }],
    });
    // ждём обработку: очередь пуста
    await waitFor(async () => {
      const state = await channel.checkQueue(QUEUE);
      return state.messageCount === 0 ? state : null;
    });

    const [user] = await users.findBy({ userId: CORE_USER });
    const allUsers = await users.findBy({ userId: CORE_USER });
    const alive = await credentials.findBy({
      userId: user.id,
      isDeleted: false,
    });
    expect(allUsers).toHaveLength(1);
    expect(alive).toHaveLength(2);
  });

  it('смена email через событие: коды пойдут на новый канал', async () => {
    publish({
      userId: CORE_USER,
      credentials: [{ type: 'email', identity: 'new@b.com' }],
    });

    const [user] = await users.findBy({ userId: CORE_USER });
    const updated = await waitFor(async () => {
      const alive = await credentials.findBy({
        userId: user.id,
        isDeleted: false,
      });
      return alive.some((row) => row.identity === 'new@b.com') ? alive : null;
    });
    expect(updated.map((row) => row.identity).sort()).toEqual([
      '+89123453345',
      'new@b.com',
    ]);
    const dead = (await credentials.findBy({ userId: user.id })).filter(
      (row) => row.isDeleted,
    );
    expect(dead.map((row) => row.identity)).toEqual(['a@b.com']);
  });

  it('битое сообщение подтверждается (очередь не зацикливается)', async () => {
    publish({ nonsense: true });

    await waitFor(async () => {
      const state = await channel.checkQueue(QUEUE);
      return state.messageCount === 0 ? state : null;
    });
    // консьюмер жив: следующее валидное событие обрабатывается
    publish({
      userId: '44444444-4444-4444-4444-444444444444',
      credentials: [],
    });
    await waitFor(async () => {
      const [row] = await users.findBy({
        userId: '44444444-4444-4444-4444-444444444444',
      });
      return row;
    });
  });
});
