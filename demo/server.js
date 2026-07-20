/* eslint-disable */
/**
 * Демо-компаньон 2ФА-сервиса. Играет три роли из архитектуры:
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
  .catch((error) => {
    console.error('RMQ connect failed:', error.message);
    process.exit(1);
  });
