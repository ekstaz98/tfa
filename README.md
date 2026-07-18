# 2ФА-сервис (скелет)

Микросервис двухфакторной аутентификации: конфигурация методов админом
(плюс автосинк из гейтвея), пользовательские настройки, генерация и отправка
кодов (за портом), верификация по запросу гейтвея, поддержка авторизованных
и неавторизованных клиентов (signin, регистрация).

План — `../2fa_service_plan.md`, схема БД — `../2fa_schema.dbml`,
юз-кейсы — `../2fa_use_cases.md`.

Стек: NestJS 10, PostgreSQL + TypeORM (только миграции, snake_case),
GraphQL code-first (Apollo), RabbitMQ (только consumer синхронизации юзеров),
`@nestjs/schedule` (единственный джоб — retention).

## Запуск

```bash
npm install
cp .env.example .env   # заполнить секреты (см. ниже)
docker compose up -d   # postgres + rabbitmq
npm run migration:run
npm run start:dev      # GraphQL: http://localhost:3000/graphql
```

## Env

Обязательные, без дефолтов (без них приложение не стартует):

| Переменная | Что это |
|---|---|
| `DATABASE_URL` | DSN Postgres |
| `RMQ_URL` | URL RabbitMQ |
| `CODES_HMAC_SECRET` | секрет HMAC-SHA256 хэшей кодов, ≥32 символов |
| `TOTP_ENC_KEYS` | ключи AES-256-GCM для TOTP-секретов: JSON `{"<версия>":"<64 hex>"}` |
| `TOTP_ENC_KEY_VERSION` | версия ключа для шифрования новых секретов |

Ротация TOTP-ключа: добавить новую версию в `TOTP_ENC_KEYS`, переключить
`TOTP_ENC_KEY_VERSION`; старые версии остаются для расшифровки (версия
хранится в префиксе шифртекста).

Опциональные (дефолты): `RMQ_USERS_QUEUE` (tfa-users-sync), `CODE_LENGTH` (6),
`CODE_TTL_SECONDS` (300 — единый TTL кода и операции), `CODE_RETRY_SECONDS`
(120), `CODE_ATTEMPTS_LIMIT` (3), `CODE_RESENDS_LIMIT` (3),
`OPERATIONS_DAILY_LIMIT` (10 — на «актор × метод»), `UNAUTHED_IP_HOURLY_LIMIT`
(20), `RETENTION_DAYS` (30), `GATEWAY_GRAPHQL_URL` (без него недоступен
автосинк `updateListMethods`), `SEND_EVENT_NAME` (TFA_OTP),
`SEND_PROVIDER_MAP` (`{"email":"smtp","sms":"sms"}` — тип 2ФА → providerName).

## Миграции

```bash
npm run migration:generate src/database/migrations/<Name>
npm run migration:run
npm run migration:revert
```

Схема управляется только миграциями (`synchronize: false`). Сид создаёт
справочники: tags `unauthed|user|system|default`, types `sms|email|push|ga`.
Методы в сид не входят — заводятся админ-мутацией или автосинком.

## GraphQL API

Схема генерируется в `schema.gql` при старте. Имена из ТЗ вида `2fa*`
невозможны в GraphQL (имя не может начинаться с цифры) и переименованы в
`twoFa*`/`TwoFa*`. Типы и теги во входных параметрах — енамы
`TwoFaMethodType` (`SMS`, `EMAIL`, `PUSH`, `GA`) и `TwoFaMethodTag`
(`UNAUTHED`, `USER`, `SYSTEM`, `DEFAULT`); в ответах — строки в нижнем
регистре, как в базе.

- `Query twoFaTypes` — справочник типов;
- `Query twoFaMethods(input: { hash, tags })` — эффективный список для
  клиента: только методы, реально требующие 2ФА для актора; hash совпал →
  `{ upToDate: true, methods: null }`;
- `Query myTwoFaMethods` — экран настроек юзера (заголовок `x-user-id`):
  все методы с тегом `user`, включая выключенные юзером; на каждый —
  `allowedTypes` (набор админа), `enabledTypes` (действующие сейчас;
  пусто = 2ФА выключена) и `isEnabled`. Источник `id` и типов для
  `updateMyTwoFaMethod`;
- `Mutation sendTwoFa(input: { method, identity?, types?, locale? })` —
  `identity` обязателен без авторизации и запрещён при ней; заголовок
  `x-2fa-operationid` включает переотправку (`types` — её подмножество);
- `Mutation createTwoFaMethod / updateTwoFaMethod` — роль `admin`;
- `Mutation updateMyTwoFaMethod` — юзер (заголовок `x-user-id`), только методы
  с тегом `user`; `isActive: false` выключает 2ФА по методу, включение
  обратно — `isActive: true` + явный список `types`;
- `Mutation updateTwoFaListMethods` — роль `service`, автосинк методов
  интроспекцией схемы гейтвея;
- `Mutation verifyTwoFa` — роль `service`, две формы (ниже).

Ошибки — всегда `{"errors":[{ message, title, code, status }]}`
(коды `UNKNOWN_TAG-001` … по ТЗ + скелетные 006–019).

### verifyTwoFa (контракт для гейтвея)

```graphql
verifyTwoFa(input: {
  operationId: ID       # опционально
  method: String!
  userId: String        # authed-запросы
  identity: String      # unauthed-запросы (login из signin)
  codes: [{ type, code }]
}) { verified required userId identity }
```

- **с `operationId`** — верификация кодов перед проксированием целевого
  запроса (хедеры клиента `x-2fa-operationId`/`x-2fa-codes` разбирает
  гейтвей); успех → `{ verified: true, userId, identity }`;
- **без `operationId`** — «покрыт ли метод»: `{ required: boolean }` для
  `(method, userId | identity)`; неизвестный/неактивный метод →
  `required: false`; ответ по identity учитывает настройки юзера — юзер
  может полностью отключить 2ФА на signin.

### Требования к гейтвею

- заголовки: `x-user-id` (core userId), `x-roles` (`admin`/`service`, через
  запятую), `x-client-ip` (опора часового лимита unauthed-операций),
  `x-2fa-operationid` (переотправка);
- для unauthed-методов гейтвей обязан извлечь identity из тела запроса и
  передать его в `verifyTwoFa`/`sendTwoFa`.

Авторизация — зона гейтвея: сервис доверяет заголовкам, guards — заглушки.

## Отправка кодов (порт + мок)

Домен публикует событие за портом `CodeSendPublisherPort` в формате
events-сервиса интегрирующей системы:

```json
{ "event": "TFA_OTP",
  "data": {
    "data": { "code": "123456", "sentAt": "ISO", "operationId": "uuid", "locale": "ru" },
    "destination": { "address": "+79123453345", "providerName": "sms" } } }
```

В скелете единственная реализация — `MockCodeSendPublisher` (in-memory,
e2e читают коды из него; API чтения кодов в сервисе нет). Живой адаптер:
реализовать `CodeSendPublisherPort` и заменить провайдер токена
`CODE_SEND_PUBLISHER` в `operations.module.ts` — домен и контракты не меняются.
Шаблоны/тайтлы нотификаций — ответственность сервиса отправки; 2ФА-сервис
отдаёт код и локаль. Публикация — после коммита, fire-and-forget; recovery —
переотправка.

## Синхронизация юзеров (RMQ)

Consumer очереди `RMQ_USERS_QUEUE` принимает события в Nest-конверте:

```json
{ "pattern": "user.sync",
  "data": { "userId": "uuid", "credentials": [{ "type": "email", "identity": "a@b.com" }] } }
```

Одно и то же событие — на создание юзера и смену email/phone: upsert по
`(user_id, type_id)` среди неудалённых, identity нормализуется (email —
lowercase, phone — E.164), креды из событий подтверждены
(`is_confirmed = true`). Ack — после записи; ошибка обработки → requeue
(DLQ нет); битый payload подтверждается и логируется.

Известные ограничения:
- события удаления/деактивации юзера в контракте нет — не реализовано,
  пока интегрирующая система его не заведёт;
- перенос identity между юзерами упрётся в unique(type_id, identity) —
  событие уйдёт в requeue, разрешение конфликта за интегрирующей системой.

## Как расширять

**Новый тип 2ФА** — INSERT в `types`, без миграций и кода. Отправляемые типы
(sms/email-подобные) верифицируются `HashCodeVerifier` по умолчанию;
providerName события задаётся в `SEND_PROVIDER_MAP`. Типу со своей
верификацией (как `ga`) — реализация `CodeVerifierPort` + регистрация в
`VerifierRegistry`.

**Новый метод** — админ-мутация `createTwoFaMethod` или автосинк
`updateListMethods` (новый метод из схемы гейтвея создаётся активным с
пустыми types/tags — 2ФА не требует, пока админ не настроит). Поведение
метода определяется только тегами: `system` — обязателен для всех, не
отключается; `default` (или без режимного тега) — конфигурация метода для
всех; `user` — юзер переопределяет через `updateMyTwoFaMethod`; `unauthed` —
доступен без токена; `system + unauthed` = регистрационный (код уходит на
незнакомый identity).

## Тесты

```bash
npm run test       # юнит-тесты (test/**)
npm run test:e2e   # нужен docker compose (postgres + rabbitmq)
```

e2e ходят в отдельные базы (`tfa_e2e*`, пересоздаются при прогоне), включая
сквозной сценарий: регистрация → RMQ-событие юзера → signin по identity →
updateMyTwoFaMethod → transfer через verifyTwoFa.

## Вне скоупа скелета

`payload_hash` (привязка операции к пейлоаду), enrollment GA (QR/подтверждение),
push-доставка (тип в справочнике, кредов не существует), backup-коды,
защитные пороги автосинка, outbox, кэш конфигурации — см. план.
