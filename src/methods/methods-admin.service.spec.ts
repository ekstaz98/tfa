import { Method, MethodTag, MethodType, Tag, Type } from '../database/entities';
import { TwoFaError } from '../errors';
import { MethodViewsService, MethodsAdminService } from './services';
import { FakeCrud, fakeDataSource, seedDictionaries } from '../testing/fakes';

describe('MethodsAdminService', () => {
  let methodsCrud: FakeCrud<Method>;
  let methodTypesCrud: FakeCrud<MethodType>;
  let methodTagsCrud: FakeCrud<MethodTag>;
  let typesCrud: FakeCrud<Type>;
  let tagsCrud: FakeCrud<Tag>;
  let service: MethodsAdminService;

  beforeEach(() => {
    methodsCrud = new FakeCrud<Method>({
      isActive: true,
      isDeleted: false,
    } as Partial<Method>);
    methodTypesCrud = new FakeCrud<MethodType>();
    methodTagsCrud = new FakeCrud<MethodTag>();
    typesCrud = new FakeCrud<Type>();
    tagsCrud = new FakeCrud<Tag>();
    seedDictionaries(tagsCrud, typesCrud);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const views = new MethodViewsService(
      methodTypesCrud as any,
      methodTagsCrud as any,
      typesCrud as any,
      tagsCrud as any,
    );
    service = new MethodsAdminService(
      fakeDataSource(),
      methodsCrud as any,
      methodTypesCrud as any,
      methodTagsCrud as any,
      typesCrud as any,
      tagsCrud as any,
      views,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

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

  describe('createMethods', () => {
    it('создаёт метод со связями и возвращает вид 2faMethods', async () => {
      const views = await service.createMethods([
        { method: 'transfer', types: ['email', 'sms'], tags: ['user'] },
      ]);

      expect(views).toEqual([
        {
          id: expect.any(String),
          method: 'transfer',
          isActive: true,
          isDeleted: false,
          types: ['email', 'sms'],
          tags: ['user'],
        },
      ]);
      expect(methodTypesCrud.rows).toHaveLength(2);
      expect(methodTagsCrud.rows).toHaveLength(1);
    });

    it('неизвестный тег → UNKNOWN_TAG-001', () =>
      expectCode(
        service.createMethods([{ method: 'a', types: [], tags: ['vip'] }]),
        'UNKNOWN_TAG-001',
      ));

    it('неизвестный тип → UNKNOWN_TYPE-004', () =>
      expectCode(
        service.createMethods([{ method: 'a', types: ['fax'], tags: [] }]),
        'UNKNOWN_TYPE-004',
      ));

    it('два режимных тега → TAGS_CONFLICT-019', () =>
      expectCode(
        service.createMethods([
          { method: 'a', types: [], tags: ['system', 'user'] },
        ]),
        'TAGS_CONFLICT-019',
      ));

    it('режимный тег + unauthed — допустимо (unauthed ортогонален)', async () => {
      const views = await service.createMethods([
        { method: 'signup', types: ['sms'], tags: ['system', 'unauthed'] },
      ]);
      expect(views[0].tags).toEqual(['system', 'unauthed']);
    });

    it('дубль имени в одном запросе → WRONG_METHOD-005', () =>
      expectCode(
        service.createMethods([
          { method: 'a', types: [], tags: [] },
          { method: 'a', types: [], tags: [] },
        ]),
        'WRONG_METHOD-005',
      ));

    it('дубль среди неудалённых → WRONG_METHOD-005; удалённый не мешает', async () => {
      methodsCrud.seed({ method: 'a', isDeleted: false } as Partial<Method>);
      await expectCode(
        service.createMethods([{ method: 'a', types: [], tags: [] }]),
        'WRONG_METHOD-005',
      );

      methodsCrud.rows = [];
      methodsCrud.seed({ method: 'b', isDeleted: true } as Partial<Method>);
      const views = await service.createMethods([
        { method: 'b', types: [], tags: [] },
      ]);
      expect(views[0].method).toBe('b');
    });
  });

  describe('updateMethods', () => {
    it('неизвестный id → UNKNOWN_METHOD-002', () =>
      expectCode(
        service.updateMethods([{ id: 'missing' }]),
        'UNKNOWN_METHOD-002',
      ));

    it('связи меняются диффом: лишние удаляются, недостающие создаются', async () => {
      const [created] = await service.createMethods([
        { method: 'transfer', types: ['sms', 'email'], tags: ['user'] },
      ]);
      const keptRowIds = methodTypesCrud.rows.map((row) => row.id);

      const [updated] = await service.updateMethods([
        { id: created.id, types: ['email', 'ga'] },
      ]);

      expect(updated.types).toEqual(['email', 'ga']);
      // строка email не пересоздавалась
      const emailRow = methodTypesCrud.rows.find(
        (row) => row.typeId === 'type-email',
      );
      expect(keptRowIds).toContain(emailRow?.id);
      expect(
        methodTypesCrud.rows.some((row) => row.typeId === 'type-sms'),
      ).toBe(false);
    });

    it('валидация режимных тегов при update → TAGS_CONFLICT-019', async () => {
      const [created] = await service.createMethods([
        { method: 'a', types: [], tags: [] },
      ]);
      await expectCode(
        service.updateMethods([{ id: created.id, tags: ['default', 'user'] }]),
        'TAGS_CONFLICT-019',
      );
    });

    it('переименование в существующее активное имя → WRONG_METHOD-005', async () => {
      await service.createMethods([{ method: 'a', types: [], tags: [] }]);
      const [b] = await service.createMethods([
        { method: 'b', types: [], tags: [] },
      ]);
      await expectCode(
        service.updateMethods([{ id: b.id, method: 'a' }]),
        'WRONG_METHOD-005',
      );
    });

    describe('guard системных методов', () => {
      let systemMethodId: string;

      beforeEach(async () => {
        const [created] = await service.createMethods([
          { method: 'signup', types: ['sms'], tags: ['system', 'unauthed'] },
        ]);
        systemMethodId = created.id;
      });

      it.each([
        ['выключить', { isActive: false }],
        ['удалить', { isDeleted: true }],
        ['опустошить типы', { types: [] as string[] }],
      ])('нельзя %s system-метод → SYSTEM_METHOD_LOCKED-018', (_name, patch) =>
        expectCode(
          service.updateMethods([{ id: systemMethodId, ...patch }]),
          'SYSTEM_METHOD_LOCKED-018',
        ),
      );

      it('после снятия тега system метод управляем как обычный', async () => {
        await service.updateMethods([
          { id: systemMethodId, tags: ['unauthed'] },
        ]);
        const [updated] = await service.updateMethods([
          { id: systemMethodId, isActive: false },
        ]);
        expect(updated.isActive).toBe(false);
      });
    });
  });
});
