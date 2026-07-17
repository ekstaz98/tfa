import { CodeGeneratorService } from '../../src/operations/services';
import { fakeConfig } from '../testing/fakes';

describe('CodeGeneratorService', () => {
  const service = new CodeGeneratorService(
    fakeConfig({ 'codes.hmacSecret': 's'.repeat(32), 'codes.length': 6 }),
  );

  it('генерирует код фиксированной длины с паддингом', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(service.generate()).toMatch(/^\d{6}$/);
    }
  });

  it('hash детерминирован и не содержит код', () => {
    const hash = service.hash('123456');
    expect(hash).toBe(service.hash('123456'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('123456');
  });

  it('matches: верный код проходит, неверный — нет', () => {
    const hash = service.hash('123456');
    expect(service.matches('123456', hash)).toBe(true);
    expect(service.matches('123457', hash)).toBe(false);
  });

  it('matches с NULL-хэшем (GA-строка) всегда false', () => {
    expect(service.matches('123456', null)).toBe(false);
  });

  it('randomHash валиден по формату и не совпадает с кодами', () => {
    const hash = service.randomHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(service.matches('123456', hash)).toBe(false);
  });
});
