import { TwoFaRequirementService } from '../../src/operations/services';
import { OperationsTestBed, buildTestBed } from './setup';

const CORE_USER = 'core-user-1';

describe('TwoFaRequirementService.isRequired (verifyTwoFa без operationId)', () => {
  let bed: OperationsTestBed;
  let service: TwoFaRequirementService;

  beforeEach(() => {
    bed = buildTestBed();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    service = new TwoFaRequirementService(
      bed.crud.methods as any,
      bed.crud.users as any,
      bed.crud.credentials as any,
      bed.normalizer,
      bed.effectiveMethods,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  it('покрытый метод для authed-юзера → true', async () => {
    bed.addMethod('transfer', ['sms'], ['user']);
    bed.addUser(CORE_USER);

    expect(
      await service.isRequired({ method: 'transfer', userId: CORE_USER }),
    ).toBe(true);
  });

  it('неизвестный метод → false (не настроен = не покрыт)', async () => {
    expect(
      await service.isRequired({ method: 'ghost', userId: CORE_USER }),
    ).toBe(false);
  });

  it('неактивный метод → false', async () => {
    const method = bed.addMethod('transfer', ['sms'], ['user']);
    method.isActive = false;

    expect(
      await service.isRequired({ method: 'transfer', userId: CORE_USER }),
    ).toBe(false);
  });

  it('required по identity учитывает настройки юзера: 2ФА отключена → false', async () => {
    const signIn = bed.addMethod('signIn', ['email'], ['unauthed', 'user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'email', 'a@b.com');
    bed.crud.userMethods.seed({
      userId: user.id,
      methodId: signIn.id,
      isActive: false,
    });

    expect(
      await service.isRequired({ method: 'signIn', identity: 'A@B.com ' }),
    ).toBe(false);
  });

  it('identity известного юзера без переопределений → по конфигурации метода', async () => {
    bed.addMethod('signIn', ['email'], ['unauthed', 'user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'email', 'a@b.com');

    expect(
      await service.isRequired({ method: 'signIn', identity: 'a@b.com' }),
    ).toBe(true);
  });

  it('неизвестный identity → ответ по конфигурации метода', async () => {
    bed.addMethod('signIn', ['email'], ['unauthed', 'user']);

    expect(
      await service.isRequired({
        method: 'signIn',
        identity: 'ghost@mail.com',
      }),
    ).toBe(true);
  });

  it('authed непокрытый метод (юзер отключил) → false', async () => {
    const transfer = bed.addMethod('transfer', ['sms'], ['user']);
    const user = bed.addUser(CORE_USER);
    bed.crud.userMethods.seed({
      userId: user.id,
      methodId: transfer.id,
      isActive: false,
    });

    expect(
      await service.isRequired({ method: 'transfer', userId: CORE_USER }),
    ).toBe(false);
  });

  describe('opt-in (USER_METHODS_ACTIVE=false): user-метод по умолчанию выключен', () => {
    let optInBed: OperationsTestBed;
    let optInService: TwoFaRequirementService;

    beforeEach(() => {
      optInBed = buildTestBed({ 'methods.userDefaultActive': false });
      /* eslint-disable @typescript-eslint/no-explicit-any */
      optInService = new TwoFaRequirementService(
        optInBed.crud.methods as any,
        optInBed.crud.users as any,
        optInBed.crud.credentials as any,
        optInBed.normalizer,
        optInBed.effectiveMethods,
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });

    it('authed transfer (user) без переопределения → false', async () => {
      optInBed.addMethod('transfer', ['sms'], ['user']);
      optInBed.addUser(CORE_USER);

      expect(
        await optInService.isRequired({
          method: 'transfer',
          userId: CORE_USER,
        }),
      ).toBe(false);
    });

    it('authed transfer (user) с явным включением → true (как при opt-out)', async () => {
      const transfer = optInBed.addMethod('transfer', ['sms'], ['user']);
      const user = optInBed.addUser(CORE_USER);
      optInBed.crud.userMethods.seed({
        userId: user.id,
        methodId: transfer.id,
        isActive: true,
      });
      optInBed.crud.userMethodTypes.seed({
        userMethodId: transfer.id,
        typeId: 'type-sms',
      });

      expect(
        await optInService.isRequired({
          method: 'transfer',
          userId: CORE_USER,
        }),
      ).toBe(true);
    });

    // signIn специально сделан user + unauthed (не default/system) — опция
    // "юзер сам включает 2ФА на вход" должна вести себя так же, как любой
    // другой user-метод под этой политикой.
    it('signIn (user+unauthed) по identity без переопределения → false: вход без 2ФА', async () => {
      optInBed.addMethod('signIn', ['email'], ['unauthed', 'user']);
      const user = optInBed.addUser(CORE_USER);
      optInBed.addCredential(user, 'email', 'a@b.com');

      expect(
        await optInService.isRequired({
          method: 'signIn',
          identity: 'a@b.com',
        }),
      ).toBe(false);
    });

    it('signIn: юзер сам включил (override active) → true', async () => {
      const signIn = optInBed.addMethod(
        'signIn',
        ['email'],
        ['unauthed', 'user'],
      );
      const user = optInBed.addUser(CORE_USER);
      optInBed.addCredential(user, 'email', 'a@b.com');
      optInBed.crud.userMethods.seed({
        userId: user.id,
        methodId: signIn.id,
        isActive: true,
      });
      optInBed.crud.userMethodTypes.seed({
        userMethodId: signIn.id,
        typeId: 'type-email',
      });

      expect(
        await optInService.isRequired({
          method: 'signIn',
          identity: 'a@b.com',
        }),
      ).toBe(true);
    });

    it('signIn: неизвестный identity тоже → false (не false-positive для анонимности — required лишь снаружи не палит регистрацию)', async () => {
      optInBed.addMethod('signIn', ['email'], ['unauthed', 'user']);

      expect(
        await optInService.isRequired({
          method: 'signIn',
          identity: 'ghost@mail.com',
        }),
      ).toBe(false);
    });
  });
});
