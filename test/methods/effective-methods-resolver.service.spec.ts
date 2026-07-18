import {
  Method,
  MethodTag,
  MethodType,
  Tag,
  Type,
  User,
  UserMethod,
  UserMethodType,
} from '../../src/database/entities';
import { TwoFaError } from '../../src/errors';
import { EffectiveMethodsResolverService } from '../../src/methods/services';
import {
  FakeCrud,
  fakeDictionaryCache,
  seedDictionaries,
} from '../testing/fakes';

const CORE_USER_ID = 'core-user-1';

describe('EffectiveMethodsResolverService.resolve', () => {
  let usersCrud: FakeCrud<User>;
  let methodsCrud: FakeCrud<Method>;
  let methodTypesCrud: FakeCrud<MethodType>;
  let methodTagsCrud: FakeCrud<MethodTag>;
  let userMethodsCrud: FakeCrud<UserMethod>;
  let userMethodTypesCrud: FakeCrud<UserMethodType>;
  let typesCrud: FakeCrud<Type>;
  let tagsCrud: FakeCrud<Tag>;
  let service: EffectiveMethodsResolverService;
  let user: User;

  beforeEach(() => {
    usersCrud = new FakeCrud<User>({
      defaultMethodsEnabled: true,
    } as Partial<User>);
    methodsCrud = new FakeCrud<Method>({
      isActive: true,
      isDeleted: false,
    } as Partial<Method>);
    methodTypesCrud = new FakeCrud<MethodType>();
    methodTagsCrud = new FakeCrud<MethodTag>();
    userMethodsCrud = new FakeCrud<UserMethod>({
      isActive: true,
      isDeleted: false,
    } as Partial<UserMethod>);
    userMethodTypesCrud = new FakeCrud<UserMethodType>();
    typesCrud = new FakeCrud<Type>();
    tagsCrud = new FakeCrud<Tag>();
    seedDictionaries(tagsCrud, typesCrud);
    user = usersCrud.seed({ userId: CORE_USER_ID } as Partial<User>);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    service = new EffectiveMethodsResolverService(
      usersCrud as any,
      methodsCrud as any,
      methodTypesCrud as any,
      methodTagsCrud as any,
      userMethodsCrud as any,
      userMethodTypesCrud as any,
      fakeDictionaryCache(typesCrud, tagsCrud),
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  function addMethod(
    name: string,
    typeNames: string[],
    tagNames: string[],
    extra: Partial<Method> = {},
  ): Method {
    const method = methodsCrud.seed({
      method: name,
      ...extra,
    } as Partial<Method>);
    for (const type of typeNames) {
      methodTypesCrud.seed({ methodId: method.id, typeId: `type-${type}` });
    }
    for (const tag of tagNames) {
      methodTagsCrud.seed({ methodId: method.id, tagId: `tag-${tag}` });
    }
    return method;
  }

  function addOverride(
    method: Method,
    typeNames: string[],
    isActive = true,
  ): void {
    const userMethod = userMethodsCrud.seed({
      userId: user.id,
      methodId: method.id,
      isActive,
    } as Partial<UserMethod>);
    for (const type of typeNames) {
      userMethodTypesCrud.seed({
        userMethodId: userMethod.id,
        typeId: `type-${type}`,
      });
    }
  }

  it('system: переопределение юзера игнорируется', async () => {
    const signup = addMethod('signup', ['sms'], ['system', 'unauthed']);
    addOverride(signup, [], false);

    const views = await service.resolve(CORE_USER_ID);

    expect(views).toHaveLength(1);
    expect(views[0].types).toEqual(['sms']);
  });

  it('default: переопределение юзера игнорируется', async () => {
    const transfer = addMethod('transfer', ['sms', 'email'], ['default']);
    addOverride(transfer, ['email']);

    const views = await service.resolve(CORE_USER_ID);

    expect(views[0].types).toEqual(['email', 'sms']);
  });

  it('метод без режимного тега ведёт себя как default', async () => {
    const plain = addMethod('plain', ['sms'], []);
    addOverride(plain, [], false);

    const views = await service.resolve(CORE_USER_ID);

    expect(views).toHaveLength(1);
    expect(views[0].types).toEqual(['sms']);
  });

  describe('user-методы', () => {
    it('без переопределения действует конфигурация метода', async () => {
      addMethod('transfer', ['sms', 'email'], ['user']);

      const views = await service.resolve(CORE_USER_ID);

      expect(views[0].types).toEqual(['email', 'sms']);
    });

    it('переопределение сужает типы', async () => {
      const transfer = addMethod('transfer', ['sms', 'email'], ['user']);
      addOverride(transfer, ['email']);

      const views = await service.resolve(CORE_USER_ID);

      expect(views[0].types).toEqual(['email']);
    });

    it('переопределение is_active=false выключает метод для юзера', async () => {
      const transfer = addMethod('transfer', ['sms'], ['user']);
      addOverride(transfer, ['sms'], false);

      expect(await service.resolve(CORE_USER_ID)).toEqual([]);
    });

    it('несинхронизированный юзер получает конфигурацию метода', async () => {
      addMethod('transfer', ['sms'], ['user']);

      const views = await service.resolve('ghost-user');

      expect(views[0].types).toEqual(['sms']);
    });
  });

  it('userId = null → только методы с тегом unauthed', async () => {
    addMethod('signin', ['sms'], ['unauthed', 'user']);
    addMethod('transfer', ['sms'], ['user']);

    const views = await service.resolve(null);

    expect(views.map((view) => view.method)).toEqual(['signin']);
  });

  it('фильтр по тегам: метод должен содержать все запрошенные', async () => {
    addMethod('signup', ['sms'], ['system', 'unauthed']);
    addMethod('signin', ['sms'], ['unauthed', 'user']);

    const views = await service.resolve(null, ['unauthed', 'system']);

    expect(views.map((view) => view.method)).toEqual(['signup']);
  });

  it('неизвестный тег в фильтре → UNKNOWN_TAG-001', async () => {
    await expect(service.resolve(null, ['vip'])).rejects.toMatchObject({
      code: 'UNKNOWN_TAG-001',
    });
    await expect(service.resolve(null, ['vip'])).rejects.toBeInstanceOf(
      TwoFaError,
    );
  });

  it('метод с пустыми types (свежесинканный) в требования не попадает', async () => {
    addMethod('withdraw', [], []);

    expect(await service.resolve(CORE_USER_ID)).toEqual([]);
  });

  describe('общий переключатель default-методов', () => {
    it('off гасит default и безрежимные методы; user и system остаются', async () => {
      user.defaultMethodsEnabled = false;
      addMethod('transfer', ['sms'], ['default']);
      addMethod('plain', ['sms'], []);
      addMethod('secure', ['sms'], ['user']);
      addMethod('signup', ['sms'], ['system', 'unauthed']);

      const views = await service.resolve(CORE_USER_ID);

      expect(views.map((view) => view.method).sort()).toEqual([
        'secure',
        'signup',
      ]);
    });

    it('resolveMethodTypes: default-метод гаснет по флагу', async () => {
      user.defaultMethodsEnabled = false;
      const transfer = addMethod('transfer', ['sms', 'email'], ['default']);

      expect(
        await service.resolveMethodTypes(transfer, ['default'], CORE_USER_ID),
      ).toEqual([]);
      expect(
        await service.resolveMethodTypes(transfer, ['default'], user),
      ).toEqual([]);
    });

    it('resolveMethodTypes: system не гасится флагом', async () => {
      user.defaultMethodsEnabled = false;
      const signup = addMethod('signup', ['sms'], ['system', 'unauthed']);

      expect(
        await service.resolveMethodTypes(
          signup,
          ['system', 'unauthed'],
          CORE_USER_ID,
        ),
      ).toEqual(['sms']);
    });

    it('аноним/несинхронизированный: флаг не применяется, действует конфиг', async () => {
      const plain = addMethod('plain', ['sms'], ['unauthed']);
      // метод unauthed без режимного тега — виден анониму по конфигурации
      expect(
        await service.resolveMethodTypes(plain, ['unauthed'], null),
      ).toEqual(['sms']);
      expect(
        await service.resolveMethodTypes(plain, ['unauthed'], 'ghost-user'),
      ).toEqual(['sms']);
    });
  });

  describe('resolveMethodTypes (узкий резолв одного метода)', () => {
    it('совпадает с resolve() для user-метода с переопределением', async () => {
      const transfer = addMethod('transfer', ['sms', 'email'], ['user']);
      addOverride(transfer, ['email']);

      const types = await service.resolveMethodTypes(
        transfer,
        ['user'],
        CORE_USER_ID,
      );

      expect(types).toEqual(['email']);
    });

    it('system: переопределение игнорируется', async () => {
      const signup = addMethod('signup', ['sms'], ['system', 'unauthed']);
      addOverride(signup, [], false);

      expect(
        await service.resolveMethodTypes(
          signup,
          ['system', 'unauthed'],
          CORE_USER_ID,
        ),
      ).toEqual(['sms']);
    });

    it('аноним: метод без unauthed не покрыт', async () => {
      const transfer = addMethod('transfer', ['sms'], ['user']);

      expect(
        await service.resolveMethodTypes(transfer, ['user'], null),
      ).toEqual([]);
    });

    it('переданный User используется без повторного запроса юзера', async () => {
      const transfer = addMethod('transfer', ['sms', 'email'], ['user']);
      addOverride(transfer, ['sms']);

      const types = await service.resolveMethodTypes(transfer, ['user'], user);

      expect(types).toEqual(['sms']);
      expect(usersCrud.findBy).not.toHaveBeenCalled();
    });

    it('tagNames = null — теги метода дозагружаются', async () => {
      const transfer = addMethod('transfer', ['sms'], ['user']);
      addOverride(transfer, [], false);

      expect(
        await service.resolveMethodTypes(transfer, null, CORE_USER_ID),
      ).toEqual([]);
    });
  });

  it('неактивный и удалённый методы не попадают', async () => {
    addMethod('off', ['sms'], [], { isActive: false } as Partial<Method>);
    addMethod('gone', ['sms'], [], { isDeleted: true } as Partial<Method>);

    expect(await service.resolve(CORE_USER_ID)).toEqual([]);
  });
});
