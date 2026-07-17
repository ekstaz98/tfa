import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SEPARATOR = ':';

/**
 * Шифрование user_credentials.secret (TOTP) at rest: AES-256-GCM.
 * Формат шифртекста: <версия ключа>:<iv b64>:<auth tag b64>:<данные b64>.
 * Версия ключа в префиксе — ротация не окирпичивает секреты:
 * расшифровка любой известной версией, шифрование только текущей.
 */
@Injectable()
export class CredentialCipherService {
  private readonly _keys = new Map<string, Buffer>();
  private readonly _currentVersion: string;

  constructor(config: ConfigService) {
    this._currentVersion = config.getOrThrow<string>(
      'totpCipher.currentVersion',
    );
    const keys = config.getOrThrow<Record<string, string>>('totpCipher.keys');
    for (const [version, hex] of Object.entries(keys)) {
      if (version.includes(SEPARATOR)) {
        throw new Error(
          `TOTP cipher key version "${version}" must not contain "${SEPARATOR}"`,
        );
      }
      this._keys.set(version, Buffer.from(hex, 'hex'));
    }
    if (!this._keys.has(this._currentVersion)) {
      throw new Error(
        `TOTP cipher current key version "${this._currentVersion}" is missing`,
      );
    }
  }

  encrypt(plaintext: string): string {
    const key = this._keys.get(this._currentVersion) as Buffer;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const data = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [
      this._currentVersion,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      data.toString('base64'),
    ].join(SEPARATOR);
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(SEPARATOR);
    if (parts.length !== 4) {
      throw new Error('Malformed credential ciphertext');
    }
    const [version, ivB64, tagB64, dataB64] = parts;
    const key = this._keys.get(version);
    if (!key) {
      throw new Error(`Unknown credential cipher key version "${version}"`);
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
