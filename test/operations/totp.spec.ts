import {
  base32Decode,
  currentTimeStep,
  totpCode,
} from '../../src/operations/helpers/totp';

// RFC 6238, Appendix B: секрет ASCII "12345678901234567890"
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it('base32Decode декодирует RFC-секрет', () => {
    expect(base32Decode(RFC_SECRET_BASE32).toString('ascii')).toBe(
      '12345678901234567890',
    );
  });

  it('base32Decode отклоняет мусор', () => {
    expect(() => base32Decode('not base32!!')).toThrow();
  });

  it('RFC 6238 вектор: T=59s → шаг 1 → 287082 (6 цифр от 94287082)', () => {
    expect(currentTimeStep(59_000)).toBe(1);
    expect(totpCode(base32Decode(RFC_SECRET_BASE32), 1)).toBe('287082');
  });

  it('соседние шаги дают разные коды', () => {
    const secret = base32Decode(RFC_SECRET_BASE32);
    expect(totpCode(secret, 1)).not.toBe(totpCode(secret, 2));
  });
});
