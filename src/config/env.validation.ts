const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

class EnvValidationError extends Error {
  constructor(problems: string[]) {
    super(`Invalid environment:\n  - ${problems.join('\n  - ')}`);
  }
}

function isPositiveInt(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) > 0;
}

/**
 * Валидация env при старте (@nestjs/config `validate`).
 * Секреты обязательны и без дефолтов; числовые лимиты — опциональны,
 * но если заданы, обязаны быть положительными целыми.
 */
export function validateEnv(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const problems: string[] = [];
  const str = (key: string): string | undefined =>
    typeof env[key] === 'string' && (env[key] as string).length > 0
      ? (env[key] as string)
      : undefined;

  // --- обязательные, без дефолтов ---
  for (const key of ['DATABASE_URL', 'RMQ_URL']) {
    if (!str(key)) problems.push(`${key} is required`);
  }

  const hmacSecret = str('CODES_HMAC_SECRET');
  if (!hmacSecret) {
    problems.push('CODES_HMAC_SECRET is required');
  } else if (hmacSecret.length < 32) {
    problems.push('CODES_HMAC_SECRET must be at least 32 characters');
  }

  const keysRaw = str('TOTP_ENC_KEYS');
  const keyVersion = str('TOTP_ENC_KEY_VERSION');
  if (!keysRaw) {
    problems.push(
      'TOTP_ENC_KEYS is required (JSON: {"<version>":"<64 hex chars>"})',
    );
  } else {
    try {
      const keys: unknown = JSON.parse(keysRaw);
      if (
        typeof keys !== 'object' ||
        keys === null ||
        Object.keys(keys).length === 0
      ) {
        problems.push('TOTP_ENC_KEYS must be a non-empty JSON object');
      } else {
        for (const [version, key] of Object.entries(keys)) {
          if (typeof key !== 'string' || !HEX_32_BYTES.test(key)) {
            problems.push(
              `TOTP_ENC_KEYS["${version}"] must be 64 hex chars (32-byte AES-256 key)`,
            );
          }
        }
        if (!keyVersion) {
          problems.push('TOTP_ENC_KEY_VERSION is required');
        } else if (!(keyVersion in keys)) {
          problems.push(
            `TOTP_ENC_KEY_VERSION "${keyVersion}" is missing in TOTP_ENC_KEYS`,
          );
        }
      }
    } catch {
      problems.push('TOTP_ENC_KEYS is not valid JSON');
    }
  }

  // --- опциональные с дефолтами: если заданы — положительные целые ---
  const numericKeys = [
    'PORT',
    'CODE_LENGTH',
    'CODE_TTL_SECONDS',
    'CODE_RETRY_SECONDS',
    'CODE_ATTEMPTS_LIMIT',
    'CODE_RESENDS_LIMIT',
    'OPERATIONS_DAILY_LIMIT',
    'UNAUTHED_IP_HOURLY_LIMIT',
    'RETENTION_DAYS',
  ];
  for (const key of numericKeys) {
    const value = str(key);
    if (value !== undefined && !isPositiveInt(value)) {
      problems.push(`${key} must be a positive integer, got "${value}"`);
    }
  }

  const ttl = Number(str('CODE_TTL_SECONDS') ?? 300);
  const retry = Number(str('CODE_RETRY_SECONDS') ?? 120);
  if (
    isPositiveInt(String(ttl)) &&
    isPositiveInt(String(retry)) &&
    retry >= ttl
  ) {
    problems.push(
      `CODE_RETRY_SECONDS (${retry}) must be less than CODE_TTL_SECONDS (${ttl})`,
    );
  }

  const providerMap = str('SEND_PROVIDER_MAP');
  if (providerMap !== undefined) {
    try {
      const parsed: unknown = JSON.parse(providerMap);
      if (typeof parsed !== 'object' || parsed === null) {
        problems.push('SEND_PROVIDER_MAP must be a JSON object');
      }
    } catch {
      problems.push('SEND_PROVIDER_MAP is not valid JSON');
    }
  }

  if (problems.length > 0) {
    throw new EnvValidationError(problems);
  }
  return env;
}
