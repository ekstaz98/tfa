import { Tag, Type } from '../../src/database/entities';
import { DictionaryCacheService } from '../../src/database/services';
import { FakeCrud, fakeConfig, seedDictionaries } from '../testing/fakes';

describe('DictionaryCacheService', () => {
  let typesCrud: FakeCrud<Type>;
  let tagsCrud: FakeCrud<Tag>;

  beforeEach(() => {
    typesCrud = new FakeCrud<Type>();
    tagsCrud = new FakeCrud<Tag>();
    seedDictionaries(tagsCrud, typesCrud);
  });

  function build(ttlSeconds: number): DictionaryCacheService {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return new DictionaryCacheService(
      fakeConfig({ 'dictionaries.cacheTtlSeconds': ttlSeconds }),
      typesCrud as any,
      tagsCrud as any,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  it('строит индексы: все и только активные записи', async () => {
    typesCrud.seed({
      id: 'type-off',
      type: 'off',
      isActive: false,
      isDeleted: false,
    } as Partial<Type>);
    tagsCrud.seed({
      id: 'tag-off',
      name: 'off',
      isActive: false,
    } as Partial<Tag>);

    const snapshot = await build(30).get();

    expect(snapshot.typeNameById.get('type-off')).toBe('off');
    expect(snapshot.activeTypeByName.has('off')).toBe(false);
    expect(snapshot.activeTypeByName.has('sms')).toBe(true);
    expect(snapshot.tagNameById.get('tag-off')).toBe('off');
    expect(snapshot.knownTagNames.has('off')).toBe(true);
    expect(snapshot.activeTagIdByName.has('off')).toBe(false);
    expect(snapshot.activeTagIdByName.get('user')).toBe('tag-user');
  });

  it('в пределах TTL повторный get не ходит в базу', async () => {
    const cache = build(30);
    await cache.get();
    await cache.get();

    expect(typesCrud.findBy).toHaveBeenCalledTimes(1);
    expect(tagsCrud.findBy).toHaveBeenCalledTimes(1);
  });

  it('TTL 0 — каждый get перечитывает справочники', async () => {
    const cache = build(0);
    await cache.get();
    await cache.get();

    expect(typesCrud.findBy).toHaveBeenCalledTimes(2);
  });

  it('invalidate сбрасывает снимок', async () => {
    const cache = build(30);
    await cache.get();
    cache.invalidate();
    await cache.get();

    expect(typesCrud.findBy).toHaveBeenCalledTimes(2);
  });

  it('конкурентные промахи ждут одну загрузку', async () => {
    const cache = build(30);
    await Promise.all([cache.get(), cache.get(), cache.get()]);

    expect(typesCrud.findBy).toHaveBeenCalledTimes(1);
  });
});
