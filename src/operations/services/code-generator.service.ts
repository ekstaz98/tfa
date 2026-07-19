import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

/**
 * Генерация и хэширование одноразовых кодов.
 * Генерация — только CSPRNG; в базе — HMAC-SHA256(code, secret),
 * секрет из env; сравнение — timingSafeEqual. Plaintext живёт только
 * в памяти и в событии отправки, не логируется нигде.
 * Исключение — дев-режим CODE_STATIC_ENABLED: все коды статичные нули
 * (быстрая разработка без чтения очереди); на TOTP и пустышки не влияет.
 */
@Injectable()
export class CodeGeneratorService {
  private readonly _secret: string;
  private readonly _length: number;
  private readonly _staticCode: string | null;

  constructor(config: ConfigService) {
    this._secret = config.getOrThrow<string>('codes.hmacSecret');
    this._length = config.getOrThrow<number>('codes.length');
    this._staticCode = config.get<boolean>('codes.staticEnabled')
      ? '0'.repeat(this._length)
      : null;
    if (this._staticCode) {
      new Logger(CodeGeneratorService.name).warn(
        `CODE_STATIC_ENABLED: все коды = "${this._staticCode}" — только для дев-стенда!`,
      );
    }
  }

  generate(): string {
    if (this._staticCode) {
      return this._staticCode;
    }
    const code = randomInt(0, 10 ** this._length)
      .toString()
      .padStart(this._length, '0');

    return code;
  }

  hash(code: string): string {
    return createHmac('sha256', this._secret).update(code).digest('hex');
  }

  /** Хэш случайного значения — для операций-пустышек: ни один код не совпадёт. */
  randomHash(): string {
    return this.hash(randomBytes(32).toString('hex'));
  }

  matches(code: string, storedHash: string | null): boolean {
    if (!storedHash) {
      return false;
    }
    const actual = Buffer.from(this.hash(code));
    const expected = Buffer.from(storedHash);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
