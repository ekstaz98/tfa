# 2ФА-сервис (скелет)

Микросервис двухфакторной аутентификации: конфигурация методов, пользовательские
настройки, генерация и верификация кодов. План — `../2fa_service_plan.md`,
схема БД — `../2fa_schema.dbml`.

Стек: NestJS, PostgreSQL (TypeORM, только миграции), RabbitMQ (consumer
синхронизации юзеров), GraphQL code-first (появится на этапе API).

## Запуск

```bash
npm install
cp .env.example .env   # заполнить секреты: CODES_HMAC_SECRET, TOTP_ENC_KEYS, TOTP_ENC_KEY_VERSION
docker compose up -d   # postgres + rabbitmq
npm run migration:run
npm run start:dev
```

Секреты обязательны — без них приложение не стартует (валидация env).

## Миграции

```bash
npm run migration:generate src/database/migrations/<Name>
npm run migration:run
npm run migration:revert
```

Схема управляется только миграциями (`synchronize: false`), naming — snake_case.

## GraphQL API

Схема генерируется в `schema.gql` при старте. Имена `2faTypes`/`2faMethods`
из ТЗ невозможны в GraphQL (имя не может начинаться с цифры) →
`twoFaTypes`/`twoFaMethods`; остальные имена — по ТЗ.

### Требования к гейтвею

- заголовки: `x-user-id` (core userId), `x-roles` (`admin`/`service`,
  через запятую), `x-client-ip` (IP клиента — опора часового лимита
  unauthed-операций), `x-2fa-operationid` (переотправка кодов);
- перед проксированием защищённого запроса гейтвей вызывает мутацию
  `verify2fa` (роль `service`): с `operationId` — верификация кодов
  (хедеры `x-2fa-operationId`/`x-2fa-codes` клиента разбирает гейтвей),
  без `operationId` — ответ `{ required }` для `(method, userId | identity)`;
- для unauthed-методов (signin) гейтвей обязан извлечь identity из тела
  запроса и передать его в `verify2fa` — юзер может полностью отключить
  2ФА на signin, ответ идёт по его настройкам.

Авторизация — зона гейтвея: сервис доверяет заголовкам, guards — заглушки.

## Тесты

```bash
npm run test
npm run test:e2e   # нужен запущенный docker compose (postgres)
```

e2e ходят в отдельную базу `tfa_e2e` (пересоздаётся при каждом прогоне)
и читают коды из мок-реализации порта отправки — API чтения кодов нет.
