import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CredentialCipherService } from './credential-cipher.service';

const KEY_V1 = randomBytes(32).toString('hex');
const KEY_V2 = randomBytes(32).toString('hex');

function buildService(
  keys: Record<string, string>,
  currentVersion: string,
): CredentialCipherService {
  const config = {
    getOrThrow: (path: string) =>
      path === 'totpCipher.currentVersion' ? currentVersion : keys,
  } as unknown as ConfigService;
  return new CredentialCipherService(config);
}

describe('CredentialCipherService', () => {
  it('расшифровывает то, что зашифровал (roundtrip)', () => {
    const service = buildService({ '1': KEY_V1 }, '1');
    const secret = 'JBSWY3DPEHPK3PXP';

    const ciphertext = service.encrypt(secret);

    expect(ciphertext).not.toContain(secret);
    expect(ciphertext.startsWith('1:')).toBe(true);
    expect(service.decrypt(ciphertext)).toBe(secret);
  });

  it('каждое шифрование даёт разный шифртекст (случайный IV)', () => {
    const service = buildService({ '1': KEY_V1 }, '1');
    expect(service.encrypt('secret')).not.toBe(service.encrypt('secret'));
  });

  it('после ротации ключа расшифровывает старые секреты старой версией', () => {
    const oldService = buildService({ '1': KEY_V1 }, '1');
    const oldCiphertext = oldService.encrypt('legacy-secret');

    const rotated = buildService({ '1': KEY_V1, '2': KEY_V2 }, '2');

    expect(rotated.decrypt(oldCiphertext)).toBe('legacy-secret');
    expect(rotated.encrypt('new-secret').startsWith('2:')).toBe(true);
  });

  it('неизвестная версия ключа в шифртексте → ошибка', () => {
    const service = buildService({ '1': KEY_V1 }, '1');
    const foreign = buildService({ '9': KEY_V2 }, '9').encrypt('secret');

    expect(() => service.decrypt(foreign)).toThrow(
      'Unknown credential cipher key version "9"',
    );
  });

  it('подмена шифртекста → ошибка аутентификации GCM', () => {
    const service = buildService({ '1': KEY_V1 }, '1');
    const parts = service.encrypt('secret').split(':');
    parts[3] = Buffer.from('tampered-data-x').toString('base64');

    expect(() => service.decrypt(parts.join(':'))).toThrow();
  });

  it('мусор вместо шифртекста → понятная ошибка', () => {
    const service = buildService({ '1': KEY_V1 }, '1');
    expect(() => service.decrypt('garbage')).toThrow(
      'Malformed credential ciphertext',
    );
  });

  it('текущая версия отсутствует в наборе ключей → ошибка при создании', () => {
    expect(() => buildService({ '1': KEY_V1 }, '2')).toThrow(
      'TOTP cipher current key version "2" is missing',
    );
  });
});
