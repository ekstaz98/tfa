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

## Тесты

```bash
npm run test
npm run test:e2e
```
