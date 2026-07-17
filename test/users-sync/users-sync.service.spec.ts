import { Type, User, UserCredential } from '../../src/database/entities';
import { IdentityNormalizerService } from '../../src/operations/services';
import {
  InvalidUserSyncEventError,
  UsersSyncService,
} from '../../src/users-sync/services';
import { FakeCrud, fakeDataSource } from '../testing/fakes';

const CORE_USER = 'core-user-1';

describe('UsersSyncService', () => {
  let usersCrud: FakeCrud<User>;
  let typesCrud: FakeCrud<Type>;
  let credentialsCrud: FakeCrud<UserCredential>;
  let service: UsersSyncService;

  beforeEach(() => {
    usersCrud = new FakeCrud<User>();
    typesCrud = new FakeCrud<Type>();
    credentialsCrud = new FakeCrud<UserCredential>({
      isDeleted: false,
    } as Partial<UserCredential>);
    for (const type of ['sms', 'email']) {
      typesCrud.seed({
        id: `type-${type}`,
        type,
        isActive: true,
        isDeleted: false,
      } as Partial<Type>);
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    service = new UsersSyncService(
      fakeDataSource(),
      usersCrud as any,
      typesCrud as any,
      credentialsCrud as any,
      new IdentityNormalizerService(),
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  describe('parseEvent', () => {
    it('валидный payload проходит', () => {
      const event = service.parseEvent({
        userId: CORE_USER,
        credentials: [{ type: 'email', identity: 'a@b.com' }],
      });
      expect(event.userId).toBe(CORE_USER);
    });

    it.each([
      ['null', null],
      ['без userId', { credentials: [] }],
      ['credentials не массив', { userId: 'u', credentials: 'x' }],
      ['кред без identity', { userId: 'u', credentials: [{ type: 'email' }] }],
      [
        'кред с пустым identity',
        { userId: 'u', credentials: [{ type: 'email', identity: '  ' }] },
      ],
    ])('битый payload (%s) → InvalidUserSyncEventError', (_name, payload) => {
      expect(() => service.parseEvent(payload)).toThrow(
        InvalidUserSyncEventError,
      );
    });
  });

  describe('syncUser', () => {
    it('создание юзера: user + креды is_confirmed = true', async () => {
      await service.syncUser({
        userId: CORE_USER,
        credentials: [
          { type: 'email', identity: 'A@B.com' },
          { type: 'sms', identity: '8 (912) 345-33-45' },
        ],
      });

      expect(usersCrud.rows).toHaveLength(1);
      expect(usersCrud.rows[0].userId).toBe(CORE_USER);
      expect(credentialsCrud.rows).toHaveLength(2);
      for (const credential of credentialsCrud.rows) {
        expect(credential.isConfirmed).toBe(true);
        expect(credential.isActive).toBe(true);
      }
      // ненормализованный identity в событии хранится нормализованным
      const identities = credentialsCrud.rows.map((row) => row.identity).sort();
      expect(identities).toEqual(['+89123453345', 'a@b.com']);
    });

    it('повторная доставка не создаёт дублей (at-least-once)', async () => {
      const event = {
        userId: CORE_USER,
        credentials: [{ type: 'email', identity: 'a@b.com' }],
      };
      await service.syncUser(event);
      await service.syncUser(event);

      expect(usersCrud.rows).toHaveLength(1);
      expect(credentialsCrud.rows.filter((row) => !row.isDeleted)).toHaveLength(
        1,
      );
      expect(credentialsCrud.rows).toHaveLength(1); // и мёртвых строк нет
    });

    it('смена email: старый кред soft delete, новый insert', async () => {
      await service.syncUser({
        userId: CORE_USER,
        credentials: [{ type: 'email', identity: 'a@b.com' }],
      });
      await service.syncUser({
        userId: CORE_USER,
        credentials: [{ type: 'email', identity: 'new@b.com' }],
      });

      const alive = credentialsCrud.rows.filter((row) => !row.isDeleted);
      const dead = credentialsCrud.rows.filter((row) => row.isDeleted);
      expect(alive).toHaveLength(1);
      expect(alive[0].identity).toBe('new@b.com');
      expect(alive[0].isConfirmed).toBe(true);
      expect(dead).toHaveLength(1);
      expect(dead[0].identity).toBe('a@b.com');
    });

    it('событие только с email не трогает sms-кред (upsert по типу)', async () => {
      await service.syncUser({
        userId: CORE_USER,
        credentials: [
          { type: 'email', identity: 'a@b.com' },
          { type: 'sms', identity: '+79123453345' },
        ],
      });
      await service.syncUser({
        userId: CORE_USER,
        credentials: [{ type: 'email', identity: 'new@b.com' }],
      });

      const sms = credentialsCrud.rows.find(
        (row) => row.typeId === 'type-sms' && !row.isDeleted,
      );
      expect(sms?.identity).toBe('+79123453345');
    });

    it('неизвестный тип пропускается, остальные креды записываются', async () => {
      await service.syncUser({
        userId: CORE_USER,
        credentials: [
          { type: 'fax', identity: '123' },
          { type: 'email', identity: 'a@b.com' },
        ],
      });

      expect(credentialsCrud.rows).toHaveLength(1);
      expect(credentialsCrud.rows[0].typeId).toBe('type-email');
    });

    it('дубль типа в одном событии: действует последний', async () => {
      await service.syncUser({
        userId: CORE_USER,
        credentials: [
          { type: 'email', identity: 'first@b.com' },
          { type: 'email', identity: 'last@b.com' },
        ],
      });

      const alive = credentialsCrud.rows.filter((row) => !row.isDeleted);
      expect(alive).toHaveLength(1);
      expect(alive[0].identity).toBe('last@b.com');
    });
  });
});
