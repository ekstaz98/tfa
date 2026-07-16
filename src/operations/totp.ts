import { createHmac } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_PERIOD_SECONDS = 30;

export function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 character in TOTP secret');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238 (через RFC 4226): HMAC-SHA1, 6 цифр, шаг 30 секунд. */
export function totpCode(secret: Buffer, timeStep: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export function currentTimeStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}
