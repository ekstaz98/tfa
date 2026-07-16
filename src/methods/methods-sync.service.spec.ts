import { Method } from '../database/entities';
import { MethodsSyncService } from './methods-sync.service';
import { FakeCrud, fakeDataSource } from '../testing/fakes';

describe('MethodsSyncService.updateListMethods', () => {
  let methodsCrud: FakeCrud<Method>;
  let gatewayNames: string[];
  let service: MethodsSyncService;

  beforeEach(() => {
    methodsCrud = new FakeCrud<Method>({
      isActive: true,
      isDeleted: false,
    } as Partial<Method>);
    gatewayNames = [];
    service = new MethodsSyncService(
      { fetchMethodNames: () => Promise.resolve(gatewayNames) },
      fakeDataSource(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      methodsCrud as any,
    );
  });

  it('новый метод из гейтвея → создаётся активным без types/tags', async () => {
    gatewayNames = ['withdraw'];

    const result = await service.updateListMethods();

    expect(result).toEqual({ created: ['withdraw'], deactivated: [] });
    expect(methodsCrud.rows).toEqual([
      expect.objectContaining({
        method: 'withdraw',
        isActive: true,
        isDeleted: false,
      }),
    ]);
    // связи не создаются — метод вне выдач, пока админ не настроит
  });

  it('исчезнувший метод → is_active = false', async () => {
    methodsCrud.seed({ method: 'legacy', isActive: true } as Partial<Method>);
    gatewayNames = [];

    const result = await service.updateListMethods();

    expect(result.deactivated).toEqual(['legacy']);
    expect(methodsCrud.rows[0].isActive).toBe(false);
  });

  it('повторный синк идемпотентен', async () => {
    gatewayNames = ['transfer', 'signin'];
    await service.updateListMethods();

    const second = await service.updateListMethods();

    expect(second).toEqual({ created: [], deactivated: [] });
    expect(methodsCrud.rows).toHaveLength(2);
  });

  it('вернувшийся метод НЕ реактивируется (не перетираем ручные отключения)', async () => {
    methodsCrud.seed({
      method: 'transfer',
      isActive: false,
    } as Partial<Method>);
    gatewayNames = ['transfer'];

    const result = await service.updateListMethods();

    expect(result).toEqual({ created: [], deactivated: [] });
    expect(methodsCrud.rows[0].isActive).toBe(false);
  });

  it('ошибка интроспекции → методы не тронуты', async () => {
    methodsCrud.seed({ method: 'transfer', isActive: true } as Partial<Method>);
    service = new MethodsSyncService(
      { fetchMethodNames: () => Promise.reject(new Error('gateway down')) },
      fakeDataSource(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      methodsCrud as any,
    );

    await expect(service.updateListMethods()).rejects.toThrow('gateway down');
    expect(methodsCrud.rows[0].isActive).toBe(true);
  });

  it('пустой список из гейтвея деактивирует все методы (принятый риск)', async () => {
    methodsCrud.seed({ method: 'a', isActive: true } as Partial<Method>);
    methodsCrud.seed({ method: 'b', isActive: true } as Partial<Method>);
    gatewayNames = [];

    const result = await service.updateListMethods();

    expect(result.deactivated.sort()).toEqual(['a', 'b']);
    expect(methodsCrud.rows.every((row) => !row.isActive)).toBe(true);
  });
});
