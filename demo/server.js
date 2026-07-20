/* eslint-disable */
/**
 * Демо-компаньон 2ФА-сервиса. Играет роли из архитектуры:
 *  - админ: на старте идемпотентно заводит методы 2ФА (createTwoFaMethod) —
 *    фронт этим не занимается;
 *  - гейтвей: проксирует GraphQL, проставляя заголовки (x-user-id, x-roles,
 *    x-client-ip, x-2fa-operationid) — фронт заголовков не знает;
 *  - core-система: после регистрации публикует user.sync в RMQ;
 *  - каналы доставки: читает очередь событий отправки и показывает
 *    «входящие SMS/письма» с кодами.
 *
 * Запуск: сервис с SEND_TRANSPORT=rmq, затем `node demo/server.js`.
 * Env: DEMO_PORT (4444), GQL_URL, RMQ_URL, SEND_EVENTS_QUEUE, RMQ_USERS_QUEUE.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const express = require('express');
const amqplib = require('amqplib');

const PORT = Number(process.env.DEMO_PORT ?? 4444);
const GQL_URL = process.env.GQL_URL ?? 'http://localhost:3015/graphql';
const RMQ_URL = process.env.RMQ_URL ?? 'amqp://tfa:tfa@localhost:5672';
const SEND_QUEUE = process.env.SEND_EVENTS_QUEUE ?? 'tfa-send-events';
const USERS_QUEUE = process.env.RMQ_USERS_QUEUE ?? 'tfa-users-sync';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/** «Сессия» демо: один залогиненный юзер на всё приложение. */
const session = { userId: null };
/** «Входящие» каналов доставки: последние события отправки кодов. */
const inbox = [];

/**
 * «Реестр core»: identity -> userId созданных через демо юзеров. Нужен для
 * входа БЕЗ 2ФА (required: false): сервис в этом случае userId не отдаёт —
 * резолв юзера по identity в реальной жизни делает core. Персистится в файл,
 * чтобы переживать рестарты демо-сервера.
 */
const USERS_FILE = path.join(__dirname, 'users.json');
const userByIdentity = new Map(
  fs.existsSync(USERS_FILE)
    ? Object.entries(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')))
    : [],
);
function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(Object.fromEntries(userByIdentity), null, 2));
}
/** Зеркало нормализации сервиса: email → lowercase, phone → E.164. */
function normalizeIdentity(identity) {
  const trimmed = String(identity ?? '').trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return `+${trimmed.replace(/\D/g, '')}`;
}

let usersChannel = null;

/**
 * Конфигурация методов 2ФА — источник правды демо (роль админа). Заводится
 * идемпотентно на старте, так что фронту admin-кнопка не нужна.
 *  - signUp: system + unauthed — обязательная 2ФА при регистрации; тип (email
 *    или sms) определяет канал подтверждения, фронт под него подстраивается;
 *  - signIn: unauthed + user — юзер может отключить;
 *  - transfer: user — индивидуальная настройка каналов;
 *  - confirmChangePassword: system — обязательная 2ФА на смену пароля в ЛК.
 */
const METHODS = [
  { method: 'signUp', types: ['EMAIL'], tags: ['SYSTEM', 'UNAUTHED'] },
  { method: 'signIn', types: ['EMAIL'], tags: ['UNAUTHED', 'USER'] },
  { method: 'transfer', types: ['SMS', 'EMAIL'], tags: ['USER'] },
  { method: 'confirmChangePassword', types: ['EMAIL'], tags: ['SYSTEM'] },
];

async function gqlAdmin(query, variables) {
  const response = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-roles': 'admin' },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

/** Сид методов по одному: уже существующий (WRONG_METHOD-005) — не ошибка. */
async function seedMethods() {
  const mutation = `mutation($input: CreateMethodsInput!) {
      createTwoFaMethod(input: $input) { id method } }`;
  for (const method of METHODS) {
    const body = await gqlAdmin(mutation, { input: { methods: [method] } });
    const exists = body.errors?.some((error) =>
      String(error.code ?? '').startsWith('WRONG_METHOD-005'),
    );
    if (body.errors && !exists) {
      console.error(
        `seed ${method.method} failed:`,
        body.errors.map((error) => error.message).join('; '),
      );
    } else {
      console.log(`seed ${method.method}: ${exists ? 'exists' : 'created'}`);
    }
  }
}

/** Сервис поднимается не мгновенно — ретраим сид, пока GraphQL недоступен. */
async function seedMethodsWithRetry(attempts = 15) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await seedMethods();
      return;
    } catch (error) {
      console.log(
        `2FA service not ready for seeding (${attempt}/${attempts}): ${error.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  console.error('method seeding gave up — 2FA service unreachable');
}

async function connectRmq() {
  const connection = await amqplib.connect(RMQ_URL);
  usersChannel = await connection.createChannel();
  await usersChannel.assertQueue(USERS_QUEUE, { durable: true });

  const consumeChannel = await connection.createChannel();
  await consumeChannel.assertQueue(SEND_QUEUE, { durable: true });
  await consumeChannel.consume(SEND_QUEUE, (message) => {
    if (!message) return;
    try {
      const event = JSON.parse(message.content.toString());
      inbox.unshift({
        receivedAt: new Date().toISOString(),
        provider: event.data?.destination?.providerName,
        address: event.data?.destination?.address,
        code: event.data?.data?.code,
        operationId: event.data?.data?.operationId,
      });
      inbox.length = Math.min(inbox.length, 50);
    } catch (error) {
      console.error('bad send event:', error.message);
    }
    consumeChannel.ack(message);
  });
  console.log(`RMQ connected: inbox <- ${SEND_QUEUE}, users -> ${USERS_QUEUE}`);
}

/**
 * Прокси GraphQL «как гейтвей»: роль admin/service подставляется только по
 * явному запросу фронта (в реальной жизни это внутренние вызовы), юзер — из
 * демо-сессии, для unauthed-флоу можно передать identityMode: 'anon'.
 */
app.post('/api/gql', async (req, res) => {
  const { query, variables, role, operationId, anon } = req.body ?? {};
  const headers = { 'content-type': 'application/json' };
  if (role === 'admin' || role === 'service') headers['x-roles'] = role;
  if (session.userId && !anon) headers['x-user-id'] = session.userId;
  if (operationId) headers['x-2fa-operationid'] = operationId;
  headers['x-client-ip'] = req.ip ?? '127.0.0.1';
  try {
    const response = await fetch(GQL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
    res.status(response.status).json(await response.json());
  } catch (error) {
    res.status(502).json({ errors: [{ message: `2FA service unreachable: ${error.message}` }] });
  }
});

app.get('/api/inbox', (_req, res) => res.json(inbox));

app.get('/api/session', (_req, res) => res.json(session));
app.post('/api/session', (req, res) => {
  session.userId = req.body?.userId ?? null;
  res.json(session);
});
app.delete('/api/session', (_req, res) => {
  session.userId = null;
  res.json(session);
});

/** «Core создал юзера»: событие user.sync, как из интегрирующей системы. */
app.post('/api/core/users', (req, res) => {
  const { credentials } = req.body ?? {};
  if (!Array.isArray(credentials) || credentials.length === 0) {
    return res.status(400).json({ error: 'credentials required' });
  }
  const userId = randomUUID();
  usersChannel.sendToQueue(
    USERS_QUEUE,
    Buffer.from(JSON.stringify({ pattern: 'user.sync', data: { userId, credentials } })),
    { persistent: true },
  );
  for (const credential of credentials) {
    userByIdentity.set(normalizeIdentity(credential.identity), userId);
  }
  saveUsers();
  res.json({ userId });
});

/**
 * «Core пустил без 2ФА»: гейтвей получил required: false — пароль проверен
 * (мок), юзер резолвится по identity из реестра core и логинится без кодов.
 */
app.post('/api/login', (req, res) => {
  const userId = userByIdentity.get(normalizeIdentity(req.body?.identity));
  if (!userId) {
    return res.status(404).json({
      error: 'Юзер не найден в демо-реестре core — зарегистрируйтесь через демо',
    });
  }
  session.userId = userId;
  res.json({ userId });
});

connectRmq()
  .then(() => app.listen(PORT, () => console.log(`demo: http://localhost:${PORT}`)))
  .then(() => seedMethodsWithRetry())
  .catch((error) => {
    console.error('RMQ connect failed:', error.message);
    process.exit(1);
  });
