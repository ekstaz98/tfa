import { SettingsHashService } from './settings-hash.service';
import { MethodView } from './method-view';

const view = (overrides: Partial<MethodView>): MethodView => ({
  id: 'id-1',
  method: 'transfer',
  isActive: true,
  isDeleted: false,
  types: ['sms', 'email'],
  tags: ['user'],
  ...overrides,
});

describe('SettingsHashService', () => {
  const service = new SettingsHashService();

  it('детерминирован: порядок методов и типов не влияет', () => {
    const a = service.compute([
      view({ id: 'id-1', method: 'a', types: ['sms', 'email'] }),
      view({ id: 'id-2', method: 'b' }),
    ]);
    const b = service.compute([
      view({ id: 'id-2', method: 'b' }),
      view({ id: 'id-1', method: 'a', types: ['email', 'sms'] }),
    ]);

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('изменение конфигурации меняет хэш', () => {
    const before = service.compute([view({ types: ['sms', 'email'] })]);
    const after = service.compute([view({ types: ['email'] })]);

    expect(before).not.toBe(after);
  });

  it('волатильные поля вне фиксированного перечня не влияют на хэш', () => {
    const plain = service.compute([view({})]);
    const withNoise = service.compute([
      { ...view({}), updatedAt: new Date() } as unknown as MethodView,
    ]);

    expect(plain).toBe(withNoise);
  });

  it('пустой список тоже хэшируется стабильно', () => {
    expect(service.compute([])).toBe(service.compute([]));
  });
});
