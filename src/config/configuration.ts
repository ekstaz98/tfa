export interface AppConfig {
  port: number;
  database: {
    url: string;
  };
  rmq: {
    url: string;
    /** Очередь consumer'а синхронизации юзеров из интегрирующей системы. */
    usersQueue: string;
  };
  codes: {
    /** Секрет HMAC-SHA256 хэширования кодов; в БД не хранится. */
    hmacSecret: string;
    /** Длина одноразового кода в цифрах. */
    length: number;
    /** TTL кода = TTL операции (единственный TTL в системе). */
    ttlSeconds: number;
    /** Окно, раньше которого переотправка того же типа недоступна. */
    retrySeconds: number;
    /** Лимит попыток ввода кода на тип. */
    attemptsLimit: number;
    /** Лимит переотправок кода на тип в рамках операции. */
    resendsLimit: number;
  };
  limits: {
    /** Дневной лимит созданных операций на «актор × метод». */
    operationsPerDay: number;
    /** Часовой лимит unauthed-операций на client IP. */
    unauthedOpsPerHourPerIp: number;
  };
  retention: {
    /** Завершённые/истёкшие операции старше периода удаляются джобом. */
    days: number;
  };
  totpCipher: {
    /** Версия ключа, которой шифруются новые секреты. */
    currentVersion: string;
    /** version -> 32-байтовый ключ AES-256-GCM (hex); старые версии нужны для расшифровки. */
    keys: Record<string, string>;
  };
  gateway: {
    /** GraphQL-эндпоинт гейтвея для интроспекции в updateListMethods; без него автосинк недоступен. */
    graphqlUrl: string | null;
  };
  sendEvent: {
    /** Имя события отправки кода в events-сервисе интегрирующей системы. */
    name: string;
    /** Тип 2ФА -> providerName в destination события отправки. */
    providerByType: Record<string, string>;
  };
}

export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3000),
  database: {
    url: process.env.DATABASE_URL as string,
  },
  rmq: {
    url: process.env.RMQ_URL as string,
    usersQueue: process.env.RMQ_USERS_QUEUE ?? 'tfa-users-sync',
  },
  codes: {
    hmacSecret: process.env.CODES_HMAC_SECRET as string,
    length: Number(process.env.CODE_LENGTH ?? 6),
    ttlSeconds: Number(process.env.CODE_TTL_SECONDS ?? 300),
    retrySeconds: Number(process.env.CODE_RETRY_SECONDS ?? 120),
    attemptsLimit: Number(process.env.CODE_ATTEMPTS_LIMIT ?? 3),
    resendsLimit: Number(process.env.CODE_RESENDS_LIMIT ?? 3),
  },
  limits: {
    operationsPerDay: Number(process.env.OPERATIONS_DAILY_LIMIT ?? 10),
    unauthedOpsPerHourPerIp: Number(process.env.UNAUTHED_IP_HOURLY_LIMIT ?? 20),
  },
  retention: {
    days: Number(process.env.RETENTION_DAYS ?? 30),
  },
  totpCipher: {
    currentVersion: process.env.TOTP_ENC_KEY_VERSION as string,
    keys: JSON.parse(process.env.TOTP_ENC_KEYS ?? '{}') as Record<
      string,
      string
    >,
  },
  gateway: {
    graphqlUrl: process.env.GATEWAY_GRAPHQL_URL ?? null,
  },
  sendEvent: {
    name: process.env.SEND_EVENT_NAME ?? 'TFA_OTP',
    providerByType: JSON.parse(
      process.env.SEND_PROVIDER_MAP ?? '{"email":"smtp","sms":"sms"}',
    ) as Record<string, string>,
  },
});
