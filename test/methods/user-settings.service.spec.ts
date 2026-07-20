import {
  Method,
  MethodTag,
  MethodType,
  Tag,
  Type,
  User,
  UserCredential,
  UserMethod,
  UserMethodType,
} from '../../src/database/entities';
import { TwoFaError } from '../../src/errors';
import { UserSettingsService } from '../../src/methods/services';
import { TwoFaManagedBy } from '../../src/methods/interfaces';
import {
  FakeCrud,
  fakeDataSource,
  fakeDictionaryCache,
  fakeUserMethodPolicy,
  seedDictionaries,
} from '../testing/fakes';

const CORE_USER_ID = 'core-user-1';

describe('UserSettingsService.updateMyMethods', () => {
  let usersCrud: FakeCrud<User>;
  let credentialsCrud: FakeCrud<UserCredential>;
  let userMethodsCrud: FakeCrud<UserMethod>;
  let userMethodTypesCrud: FakeCrud<UserMethodType>;
  let methodsCrud: FakeCrud<Method>;
  let methodTypesCrud: FakeCrud<MethodType>;
  let methodTagsCrud: FakeCrud<MethodTag>;
  let typesCrud: FakeCrud<Type>;
  let tagsCrud: FakeCrud<Tag>;
  let service: UserSettingsService;
  let user: User;
  let transfer: Method;

  beforeEach(() => {
    usersCrud = new FakeCrud<User>({
      defaultMethodsEnabled: true,
    } as Partial<User>);
    credentialsCrud = new FakeCrud<UserCredential>();
    userMethodsCrud = new FakeCrud<UserMethod>({
      isActive: true,
      isDeleted: false,
    } as Partial<UserMethod>);
    userMethodTypesCrud = new FakeCrud<UserMethodType>();
    methodsCrud = new FakeCrud<Method>({
      isActive: true,
      isDeleted: false,
    } as Partial<Method>);
    methodTypesCrud = new FakeCrud<MethodType>();
    methodTagsCrud = new FakeCrud<MethodTag>();
    typesCrud = new FakeCrud<Type>();
    tagsCrud = new FakeCrud<Tag>();
    seedDictionaries(tagsCrud, typesCrud);

    user = usersCrud.seed({ userId: CORE_USER_ID } as Partial<User>);
    // метод transfer: типы sms+email, тег user
    transfer = methodsCrud.seed({ method: 'transfer' } as Partial<Method>);
    methodTypesCrud.seed({ methodId: transfer.id, typeId: 'type-sms' });
    methodTypesCrud.seed({ methodId: transfer.id, typeId: 'type-email' });
    methodTagsCrud.seed({ methodId: transfer.id, tagId: 'tag-user' });
    // подтверждённые креды: sms и email
    for (const type of ['sms', 'email']) {
      credentialsCrud.seed({
        userId: user.id,
        typeId: `type-${type}`,
        identity: `${type}-identity`,
        isConfirmed: true,
        isActive: true,
        isDeleted: false,
        secret: null,
      } as Partial<UserCredential>);
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    service = new UserSettingsService(
      fakeDataSource(),
      usersCrud as any,
      credentialsCrud as any,
      userMethodsCrud as any,
      userMethodTypesCrud as any,
      methodsCrud as any,
      methodTypesCrud as any,
      methodTagsCrud as any,
      fakeDictionaryCache(typesCrud, tagsCrud),
      fakeUserMethodPolicy(), // userMethodsActive: true — тот же opt-out, что и до флага
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  /** Тот же сетап, но с opt-in-политикой (USER_METHODS_ACTIVE=false). */
  function buildOptInService(): UserSettingsService {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return new UserSettingsService(
      fakeDataSource(),
      usersCrud as any,
      credentialsCrud as any,
      userMethodsCrud as any,
      userMethodTypesCrud as any,
      methodsCrud as any,
      methodTypesCrud as any,
      methodTagsCrud as any,
      fakeDictionaryCache(typesCrud, tagsCrud),
      fakeUserMethodPolicy(false),
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    return promise.then(
      () => {
        throw new Error(`expected TwoFaError ${code}`);
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(TwoFaError);
        expect((error as TwoFaError).code).toBe(code);
      },
    );
  }

  it('создаёт переопределение: user_method + user_method_types', async () => {
    const views = await service.updateMyMethods(CORE_USER_ID, [
      { id: transfer.id, types: ['email'] },
    ]);

    expect(views).toEqual([
      {
        id: transfer.id,
        method: 'transfer',
        isActive: true,
        isDeleted: false,
        types: ['email'],
        tags: ['user'],
      },
    ]);
    expect(userMethodsCrud.rows).toHaveLength(1);
    expect(userMethodTypesCrud.rows).toHaveLength(1);
  });

  it('повторный вызов обновляет запись, а не плодит дубли (анти-урок старого сервиса)', async () => {
    await service.updateMyMethods(CORE_USER_ID, [
      { id: transfer.id, types: ['email'] },
    ]);
    await service.updateMyMethods(CORE_USER_ID, [
      { id: transfer.id, types: ['sms'] },
    ]);

    expect(userMethodsCrud.rows).toHaveLength(1);
    expect(userMethodTypesCrud.rows).toHaveLength(1);
    expect(userMethodTypesCrud.rows[0].typeId).toBe('type-sms');
  });

  it('выключение типа = дифф user_method_types (бывший toggleTwoFaForUser)', async () => {
    await service.updateMyMethods(CORE_USER_ID, [
      { id: transfer.id, types: ['sms', 'email'] },
    ]);
    const views = await service.updateMyMethods(CORE_USER_ID, [
      { id: transfer.id, isActive: false, types: [] },
    ]);

    expect(views[0].isActive).toBe(false);
    expect(views[0].types).toEqual([]);
    expect(userMethodTypesCrud.rows).toHaveLength(0);
  });

  it('несинхронизированный юзер → UNKNOWN_IDENTITY-015', () =>
    expectCode(
      service.updateMyMethods('ghost', [{ id: transfer.id, types: [] }]),
      'UNKNOWN_IDENTITY-015',
    ));

  it('неизвестный метод → UNKNOWN_METHOD-002', () =>
    expectCode(
      service.updateMyMethods(CORE_USER_ID, [{ id: 'missing', types: [] }]),
      'UNKNOWN_METHOD-002',
    ));

  it('метод без тега user (system) → METHOD_NOT_CONFIGURABLE-017', async () => {
    const signUp = methodsCrud.seed({ method: 'signUp' } as Partial<Method>);
    methodTagsCrud.seed({ methodId: signUp.id, tagId: 'tag-system' });
    await expectCode(
      service.updateMyMethods(CORE_USER_ID, [{ id: signUp.id, types: [] }]),
      'METHOD_NOT_CONFIGURABLE-017',
    );
  });

  it('метод вовсе без тегов → METHOD_NOT_CONFIGURABLE-017 (ведёт себя как default)', async () => {
    const plain = methodsCrud.seed({ method: 'plain' } as Partial<Method>);
    await expectCode(
      service.updateMyMethods(CORE_USER_ID, [{ id: plain.id, types: [] }]),
      'METHOD_NOT_CONFIGURABLE-017',
    );
  });

  it('тип вне типов метода → UNKNOWN_TYPE-004', () =>
    expectCode(
      service.updateMyMethods(CORE_USER_ID, [
        { id: transfer.id, types: ['ga'] },
      ]),
      'UNKNOWN_TYPE-004',
    ));

  it('несуществующий тип → UNKNOWN_TYPE-004', () =>
    expectCode(
      service.updateMyMethods(CORE_USER_ID, [
        { id: transfer.id, types: ['fax'] },
      ]),
      'UNKNOWN_TYPE-004',
    ));

  it('нет подтверждённого креда для типа → UNKNOWN_IDENTITY-015', async () => {
    credentialsCrud.rows = credentialsCrud.rows.filter(
      (row) => row.typeId !== 'type-email',
    );
    await expectCode(
      service.updateMyMethods(CORE_USER_ID, [
        { id: transfer.id, types: ['email'] },
      ]),
      'UNKNOWN_IDENTITY-015',
    );
  });

  it('неподтверждённый кред не считается → UNKNOWN_IDENTITY-015', async () => {
    credentialsCrud.rows = credentialsCrud.rows.filter(
      (row) => row.typeId !== 'type-email',
    );
    credentialsCrud.seed({
      userId: user.id,
      typeId: 'type-email',
      identity: 'new@b.com',
      isConfirmed: false,
      isActive: true,
      isDeleted: false,
    } as Partial<UserCredential>);
    await expectCode(
      service.updateMyMethods(CORE_USER_ID, [
        { id: transfer.id, types: ['email'] },
      ]),
      'UNKNOWN_IDENTITY-015',
    );
  });

  it('ga без секрета в креде → UNKNOWN_IDENTITY-015; с секретом — ок', async () => {
    const withdraw = methodsCrud.seed({
      method: 'withdraw',
    } as Partial<Method>);
    methodTypesCrud.seed({ methodId: withdraw.id, typeId: 'type-ga' });
    methodTagsCrud.seed({ methodId: withdraw.id, tagId: 'tag-user' });
    const gaCredential = credentialsCrud.seed({
      userId: user.id,
      typeId: 'type-ga',
      identity: 'ga-identity',
      isConfirmed: true,
      isActive: true,
      isDeleted: false,
      secret: null,
    } as Partial<UserCredential>);

    await expectCode(
      service.updateMyMethods(CORE_USER_ID, [
        { id: withdraw.id, types: ['ga'] },
      ]),
      'UNKNOWN_IDENTITY-015',
    );

    gaCredential.secret = '1:encrypted';
    const views = await service.updateMyMethods(CORE_USER_ID, [
      { id: withdraw.id, types: ['ga'] },
    ]);
    expect(views[0].types).toEqual(['ga']);
  });

  describe('listMyMethods (Query myTwoFaMethods)', () => {
    it('без переопределения: метод включён, enabledTypes = allowedTypes', async () => {
      const views = await service.listMyMethods(CORE_USER_ID);

      expect(views).toEqual([
        {
          id: transfer.id,
          method: 'transfer',
          isEnabled: true,
          allowedTypes: ['email', 'sms'],
          enabledTypes: ['email', 'sms'],
          tags: ['user'],
          managedBy: 'method',
        },
      ]);
    });

    it('сужение типов отражается в enabledTypes, allowedTypes не меняется', async () => {
      await service.updateMyMethods(CORE_USER_ID, [
        { id: transfer.id, types: ['email'] },
      ]);

      const [view] = await service.listMyMethods(CORE_USER_ID);

      expect(view.allowedTypes).toEqual(['email', 'sms']);
      expect(view.enabledTypes).toEqual(['email']);
      expect(view.isEnabled).toBe(true);
    });

    it('выключенный метод остаётся в списке с isEnabled: false', async () => {
      await service.updateMyMethods(CORE_USER_ID, [
        { id: transfer.id, isActive: false, types: [] },
      ]);

      const [view] = await service.listMyMethods(CORE_USER_ID);

      expect(view.id).toBe(transfer.id);
      expect(view.isEnabled).toBe(false);
      expect(view.enabledTypes).toEqual([]);
      expect(view.allowedTypes).toEqual(['email', 'sms']);
    });

    it('system не попадает; default попадает с managedBy: global', async () => {
      const signUp = methodsCrud.seed({ method: 'signUp' } as Partial<Method>);
      methodTagsCrud.seed({ methodId: signUp.id, tagId: 'tag-system' });
      const plain = methodsCrud.seed({ method: 'plain' } as Partial<Method>);
      methodTagsCrud.seed({ methodId: plain.id, tagId: 'tag-default' });
      methodTypesCrud.seed({ methodId: plain.id, typeId: 'type-sms' });

      const views = await service.listMyMethods(CORE_USER_ID);

      expect(views.map((view) => view.method).sort()).toEqual([
        'plain',
        'transfer',
      ]);
      const plainView = views.find((view) => view.method === 'plain');
      expect(plainView).toMatchObject({
        managedBy: 'global',
        isEnabled: true,
        enabledTypes: ['sms'],
      });
    });

    it('общий переключатель off гасит default-методы, user-методы не трогает', async () => {
      const plain = methodsCrud.seed({ method: 'plain' } as Partial<Method>);
      methodTagsCrud.seed({ methodId: plain.id, tagId: 'tag-default' });
      methodTypesCrud.seed({ methodId: plain.id, typeId: 'type-sms' });
      await service.updateMyDefaults(CORE_USER_ID, false);

      const views = await service.listMyMethods(CORE_USER_ID);

      expect(views.find((view) => view.method === 'plain')).toMatchObject({
        isEnabled: false,
        enabledTypes: [],
        allowedTypes: ['sms'],
        managedBy: 'global',
      });
      expect(views.find((view) => view.method === 'transfer')).toMatchObject({
        isEnabled: true,
        managedBy: 'method',
      });
    });

    it('метод без настроенных типов (свежий автосинк) не попадает', async () => {
      const draft = methodsCrud.seed({ method: 'draft' } as Partial<Method>);
      methodTagsCrud.seed({ methodId: draft.id, tagId: 'tag-user' });
      const draftDefault = methodsCrud.seed({
        method: 'draft-default',
      } as Partial<Method>);
      methodTagsCrud.seed({ methodId: draftDefault.id, tagId: 'tag-default' });

      const views = await service.listMyMethods(CORE_USER_ID);

      expect(views.map((view) => view.method)).toEqual(['transfer']);
    });

    it('выключенный/удалённый админом метод не попадает', async () => {
      const off = methodsCrud.seed({
        method: 'off',
        isActive: false,
      } as Partial<Method>);
      methodTagsCrud.seed({ methodId: off.id, tagId: 'tag-user' });
      const gone = methodsCrud.seed({
        method: 'gone',
        isDeleted: true,
      } as Partial<Method>);
      methodTagsCrud.seed({ methodId: gone.id, tagId: 'tag-user' });

      const views = await service.listMyMethods(CORE_USER_ID);

      expect(views.map((view) => view.method)).toEqual(['transfer']);
    });

    it('несинхронизированный юзер → UNKNOWN_IDENTITY-015', () =>
      expectCode(service.listMyMethods('ghost'), 'UNKNOWN_IDENTITY-015'));

    describe('opt-in (USER_METHODS_ACTIVE=false)', () => {
      it('без переопределения: метод выключен, enabledTypes пуст', async () => {
        const [view] = await buildOptInService().listMyMethods(CORE_USER_ID);

        expect(view).toEqual({
          id: transfer.id,
          method: 'transfer',
          isEnabled: false,
          allowedTypes: ['email', 'sms'],
          enabledTypes: [],
          tags: ['user'],
          managedBy: 'method',
        });
      });

      it('после updateMyTwoFaMethod (opt-in) метод включается как обычно', async () => {
        await service.updateMyMethods(CORE_USER_ID, [
          { id: transfer.id, types: ['email'] },
        ]);

        const [view] = await buildOptInService().listMyMethods(CORE_USER_ID);

        expect(view.isEnabled).toBe(true);
        expect(view.enabledTypes).toEqual(['email']);
      });

      it('default-методы (managedBy: global) политикой не затрагиваются', async () => {
        const plain = methodsCrud.seed({ method: 'plain' } as Partial<Method>);
        methodTagsCrud.seed({ methodId: plain.id, tagId: 'tag-default' });
        methodTypesCrud.seed({ methodId: plain.id, typeId: 'type-sms' });

        const views = await buildOptInService().listMyMethods(CORE_USER_ID);

        expect(views.find((view) => view.method === 'plain')).toMatchObject({
          isEnabled: true,
          managedBy: 'global',
        });
      });
    });

    describe('фильтры', () => {
      beforeEach(async () => {
        // signIn (user, email) выключен юзером; plain (default, sms) включён
        const signIn = methodsCrud.seed({
          method: 'signIn',
        } as Partial<Method>);
        methodTypesCrud.seed({ methodId: signIn.id, typeId: 'type-email' });
        methodTagsCrud.seed({ methodId: signIn.id, tagId: 'tag-user' });
        methodTagsCrud.seed({ methodId: signIn.id, tagId: 'tag-unauthed' });
        await service.updateMyMethods(CORE_USER_ID, [
          { id: signIn.id, isActive: false, types: [] },
        ]);
        const plain = methodsCrud.seed({ method: 'plain' } as Partial<Method>);
        methodTagsCrud.seed({ methodId: plain.id, tagId: 'tag-default' });
        methodTypesCrud.seed({ methodId: plain.id, typeId: 'type-sms' });
      });

      it('managedBy: только global', async () => {
        const views = await service.listMyMethods(CORE_USER_ID, {
          managedBy: [TwoFaManagedBy.GLOBAL],
        });
        expect(views.map((view) => view.method)).toEqual(['plain']);
      });

      it('isEnabled: false — только выключенные', async () => {
        const views = await service.listMyMethods(CORE_USER_ID, {
          isEnabled: false,
        });
        expect(views.map((view) => view.method)).toEqual(['signIn']);
      });

      it('tags: метод должен содержать все запрошенные', async () => {
        const views = await service.listMyMethods(CORE_USER_ID, {
          tags: ['user', 'unauthed'],
        });
        expect(views.map((view) => view.method)).toEqual(['signIn']);
      });

      it('allowedTypes / enabledTypes: подмножество набора', async () => {
        const byAllowed = await service.listMyMethods(CORE_USER_ID, {
          allowedTypes: ['sms', 'email'],
        });
        expect(byAllowed.map((view) => view.method)).toEqual(['transfer']);

        // у signIn email разрешён, но выключен — enabledTypes его не содержит
        const byEnabled = await service.listMyMethods(CORE_USER_ID, {
          enabledTypes: ['email'],
        });
        expect(byEnabled.map((view) => view.method)).toEqual(['transfer']);
      });

      it('комбинация фильтров сужает до пересечения', async () => {
        const views = await service.listMyMethods(CORE_USER_ID, {
          managedBy: [TwoFaManagedBy.METHOD],
          isEnabled: true,
        });
        expect(views.map((view) => view.method)).toEqual(['transfer']);
      });

      it('пустой фильтр — весь список', async () => {
        const views = await service.listMyMethods(CORE_USER_ID, {});
        expect(views.map((view) => view.method).sort()).toEqual([
          'plain',
          'signIn',
          'transfer',
        ]);
      });
    });
  });

  describe('getMySettings / updateMyDefaults (общий переключатель)', () => {
    it('дефолт — включено; updateMyDefaults переключает и персистит', async () => {
      expect(await service.getMySettings(CORE_USER_ID)).toEqual({
        defaultMethodsEnabled: true,
      });

      const updated = await service.updateMyDefaults(CORE_USER_ID, false);
      expect(updated).toEqual({ defaultMethodsEnabled: false });
      expect(user.defaultMethodsEnabled).toBe(false);
      expect(await service.getMySettings(CORE_USER_ID)).toEqual({
        defaultMethodsEnabled: false,
      });
    });

    it('повторная установка того же значения не пишет в базу', async () => {
      await service.updateMyDefaults(CORE_USER_ID, true);
      expect(usersCrud.update).not.toHaveBeenCalled();
    });

    it('несинхронизированный юзер → UNKNOWN_IDENTITY-015', () =>
      expectCode(
        service.updateMyDefaults('ghost', false),
        'UNKNOWN_IDENTITY-015',
      ));
  });
});
