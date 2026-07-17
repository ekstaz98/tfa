import { TwoFaRequirementService } from '../../src/operations/services';
import { OperationsTestBed, buildTestBed } from './setup';

const CORE_USER = 'core-user-1';

describe('TwoFaRequirementService.isRequired (verify2fa без operationId)', () => {
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
    const signin = bed.addMethod('signin', ['email'], ['unauthed', 'user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'email', 'a@b.com');
    bed.crud.userMethods.seed({
      userId: user.id,
      methodId: signin.id,
      isActive: false,
    });

    expect(
      await service.isRequired({ method: 'signin', identity: 'A@B.com ' }),
    ).toBe(false);
  });

  it('identity известного юзера без переопределений → по конфигурации метода', async () => {
    bed.addMethod('signin', ['email'], ['unauthed', 'user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'email', 'a@b.com');

    expect(
      await service.isRequired({ method: 'signin', identity: 'a@b.com' }),
    ).toBe(true);
  });

  it('неизвестный identity → ответ по конфигурации метода', async () => {
    bed.addMethod('signin', ['email'], ['unauthed', 'user']);

    expect(
      await service.isRequired({
        method: 'signin',
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
});
