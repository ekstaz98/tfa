import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

/**
 * Генерация и хэширование одноразовых кодов.
 * Генерация — только CSPRNG; в базе — HMAC-SHA256(code, secret),
 * секрет из env; сравнение — timingSafeEqual. Plaintext живёт только
 * в памяти и в событии отправки, не логируется нигде.
 */
@Injectable()
export class CodeGeneratorService {
  private readonly secret: string;
  private readonly length: number;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('codes.hmacSecret');
    this.length = config.getOrThrow<number>('codes.length');
  }

  generate(): string {
    return randomInt(0, 10 ** this.length)
      .toString()
      .padStart(this.length, '0');
  }

  hash(code: string): string {
    return createHmac('sha256', this.secret).update(code).digest('hex');
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
