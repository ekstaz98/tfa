import './e2e-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  TypesCrudService,
  UserCredentialsCrudService,
  UsersCrudService,
} from '../src/database/crud';
import { buildDataSourceOptions } from '../src/database/typeorm-options';
import { MockCodeSendPublisher } from '../src/operations/services';

const DB_URL = process.env.DATABASE_URL as string;
const ADMIN_DB_URL = 'postgres://tfa:tfa@localhost:5432/postgres';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const SMS_IDENTITY = '+79123453345';
const EMAIL_IDENTITY = 'ggabchm@gmail.com';

const ADMIN = { 'x-roles': 'admin' };
const SERVICE = { 'x-roles': 'service' };
const AUTHED = { 'x-user-id': USER_ID };

interface GqlBody {
  data?: Record<string, any>;
  errors?: Array<{
    message: string;
    title: string;
    code: string;
    status: number;
  }>;
}

describe('2FA API (e2e)', () => {
  let app: INestApplication;
  let publisher: MockCodeSendPublisher;
  const methodIds: Record<string, string> = {};

  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_DB_URL });
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS tfa_e2e WITH (FORCE)');
    await admin.query('CREATE DATABASE tfa_e2e');
    await admin.end();

    const migrator = new DataSource(buildDataSourceOptions(DB_URL));
    await migrator.initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    publisher = app.get(MockCodeSendPublisher);

    // юзер и подтверждённые креды: синхронизация из RMQ — этап 7, сидим напрямую
    const users = app.get(UsersCrudService);
    const credentials = app.get(UserCredentialsCrudService);
    const types = app.get(TypesCrudService);
    const user = await users.create({ userId: USER_ID });
    const [sms] = await types.findBy({ type: 'sms' });
    const [email] = await types.findBy({ type: 'email' });
    await credentials.create({
      userId: user.id,
      typeId: sms.id,
      identity: SMS_IDENTITY,
      isConfirmed: true,
    });
    await credentials.create({
      userId: user.id,
      typeId: email.id,
      identity: EMAIL_IDENTITY,
      isConfirmed: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function gql(
    query: string,
    variables?: object,
    headers: Record<string, string> = {},
  ): Promise<GqlBody> {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set(headers)
      .send({ query, variables });
    return response.body as GqlBody;
  }

  function codeFor(operationId: string, typeName: string): string {
    const event = [...publisher.events]
      .reverse()
      .find(
        (candidate) =>
          candidate.data.data.operationId === operationId &&
          (typeName === 'email') ===
            candidate.data.destination.address.includes('@'),
      );
    if (!event) {
      throw new Error(`no published code for ${typeName}`);
    }
    return event.data.data.code;
  }

  const CREATE_METHODS = `mutation($input: CreateMethodsInput!) {
    createTwoFaMethod(input: $input) { id method isActive isDeleted types tags }
  }`;
  const UPDATE_METHODS = `mutation($input: UpdateMethodsInput!) {
    updateTwoFaMethod(input: $input) { id method isActive isDeleted types tags }
  }`;
  const SEND_TWO_FA = `mutation($input: SendTwoFaInput!) {
    sendTwoFa(input: $input) { operationId types { type identity expire retry } }
  }`;
  const VERIFY_TWO_FA = `mutation($input: VerifyTwoFaInput!) {
    verifyTwoFa(input: $input) { verified required userId identity }
  }`;

  describe('настройка методов (админ)', () => {
    it('createTwoFaMethod без роли admin → HTTP-403 в формате ТЗ', async () => {
      const body = await gql(CREATE_METHODS, {
        input: { methods: [{ method: 'transfer', types: [], tags: [] }] },
      });
      expect(body.errors).toEqual([
        {
          message: 'Role "admin" is required',
          title: 'Request rejected',
          code: 'HTTP-403',
          status: 403,
        },
      ]);
    });

    it('админ создаёт transfer, signin, signup', async () => {
      const body = await gql(
        CREATE_METHODS,
        {
          input: {
            methods: [
              { method: 'transfer', types: ['SMS', 'EMAIL'], tags: ['USER'] },
              {
                method: 'signin',
                types: ['EMAIL'],
                tags: ['UNAUTHED', 'USER'],
              },
              {
                method: 'signup',
                types: ['SMS'],
                tags: ['SYSTEM', 'UNAUTHED'],
              },
            ],
          },
        },
        ADMIN,
      );
      expect(body.errors).toBeUndefined();
      const created = body.data!.createTwoFaMethod as Array<{
        id: string;
        method: string;
      }>;
      expect(created).toHaveLength(3);
      for (const view of created) {
        methodIds[view.method] = view.id;
      }
    });

    it('все коды ошибок ТЗ воспроизводятся', async () => {
      const cases: Array<[string, GqlBody]> = [
        // tags в create/update — enum: неизвестное значение отсекается на
        // валидации GraphQL (BAD_REQUEST-400), UNKNOWN_TAG-001 через API
        // недостижим и покрыт юнитом methods-admin.service.spec
        [
          'BAD_REQUEST-400',
          await gql(
            UPDATE_METHODS,
            {
              input: { methods: [{ id: methodIds.transfer, tags: ['vip'] }] },
            },
            ADMIN,
          ),
        ],
        [
          'UNKNOWN_METHOD-002',
          await gql(
            `mutation { updateTwoFaMethod(input: { methods: [{ id: "99999999-9999-9999-9999-999999999999" }] }) { id } }`,
            undefined,
            ADMIN,
          ),
        ],
        [
          'WRONG_METHOD-003',
          await gql(SEND_TWO_FA, {
            input: { method: 'transfer', identity: SMS_IDENTITY },
          }),
        ],
        // types — enum, несуществующий тип отсекается валидацией GraphQL;
        // UNKNOWN_TYPE-004 достижим валидным типом вне типов метода
        [
          'UNKNOWN_TYPE-004',
          await gql(
            `mutation($input: UpdateMyMethodsInput!) {
              updateMyTwoFaMethod(input: $input) { id }
            }`,
            {
              input: { methods: [{ id: methodIds.transfer, types: ['PUSH'] }] },
            },
            AUTHED,
          ),
        ],
        [
          'WRONG_METHOD-005',
          await gql(
            CREATE_METHODS,
            {
              input: { methods: [{ method: 'transfer', types: [], tags: [] }] },
            },
            ADMIN,
          ),
        ],
      ];
      for (const [code, body] of cases) {
        expect(body.errors).toHaveLength(1);
        const error = body.errors![0];
        expect(error.code).toBe(code);
        expect(Object.keys(error).sort()).toEqual([
          'code',
          'message',
          'status',
          'title',
        ]);
      }
    });
  });

  describe('списки', () => {
    it('twoFaTypes отдаёт справочник', async () => {
      const body = await gql(`{ twoFaTypes { id type isActive isDeleted } }`);
      const names = (body.data!.twoFaTypes as Array<{ type: string }>).map(
        (row) => row.type,
      );
      expect(names.sort()).toEqual(['email', 'ga', 'push', 'sms']);
    });

    it('twoFaMethods: список + hash; повторный запрос с hash → upToDate', async () => {
      const query = `query($input: TwoFaMethodsInput) {
        twoFaMethods(input: $input) { hash upToDate methods { method types tags } }
      }`;
      const first = await gql(query, { input: {} }, AUTHED);
      const { hash, methods } = first.data!.twoFaMethods;
      expect(
        (methods as Array<{ method: string }>)
          .map((view) => view.method)
          .sort(),
      ).toEqual(['signin', 'signup', 'transfer']);

      const second = await gql(query, { input: { hash } }, AUTHED);
      expect(second.data!.twoFaMethods).toEqual({
        hash,
        upToDate: true,
        methods: null,
      });
    });
  });

  describe('полный цикл: sendTwoFa → verifyTwoFa', () => {
    let operationId: string;

    it('sendTwoFa (authed transfer): маскированные identity, expire, retry', async () => {
      const body = await gql(
        SEND_TWO_FA,
        { input: { method: 'transfer' } },
        AUTHED,
      );
      expect(body.errors).toBeUndefined();
      const result = body.data!.sendTwoFa;
      operationId = result.operationId;
      expect(result.types).toEqual(
        expect.arrayContaining([
          { type: 'sms', identity: '+7912...3345', expire: 300, retry: 120 },
          {
            type: 'email',
            identity: 'gg...hm@gmail.com',
            expire: 300,
            retry: 120,
          },
        ]),
      );
    });

    it('verifyTwoFa с чужим method → UNKNOWN_OPERATION-008', async () => {
      const body = await gql(
        VERIFY_TWO_FA,
        {
          input: {
            operationId,
            method: 'signin',
            userId: USER_ID,
            codes: [{ type: 'SMS', code: '000000' }],
          },
        },
        SERVICE,
      );
      expect(body.errors![0].code).toBe('UNKNOWN_OPERATION-008');
    });

    it('verifyTwoFa с чужим userId → UNKNOWN_OPERATION-008', async () => {
      const body = await gql(
        VERIFY_TWO_FA,
        {
          input: {
            operationId,
            method: 'transfer',
            userId: '22222222-2222-2222-2222-222222222222',
            codes: [{ type: 'SMS', code: '000000' }],
          },
        },
        SERVICE,
      );
      expect(body.errors![0].code).toBe('UNKNOWN_OPERATION-008');
    });

    it('verifyTwoFa без роли service → HTTP-403', async () => {
      const body = await gql(VERIFY_TWO_FA, {
        input: { operationId, method: 'transfer', userId: USER_ID, codes: [] },
      });
      expect(body.errors![0].code).toBe('HTTP-403');
    });

    it('verifyTwoFa с кодами из мок-паблишера → verified', async () => {
      const body = await gql(
        VERIFY_TWO_FA,
        {
          input: {
            operationId,
            method: 'transfer',
            userId: USER_ID,
            codes: [
              { type: 'SMS', code: codeFor(operationId, 'sms') },
              { type: 'EMAIL', code: codeFor(operationId, 'email') },
            ],
          },
        },
        SERVICE,
      );
      expect(body.errors).toBeUndefined();
      expect(body.data!.verifyTwoFa).toEqual({
        verified: true,
        required: null,
        userId: USER_ID,
        identity: null,
      });
    });

    it('повторный verify той же операции → OPERATION_USED-010', async () => {
      const body = await gql(
        VERIFY_TWO_FA,
        {
          input: {
            operationId,
            method: 'transfer',
            userId: USER_ID,
            codes: [
              { type: 'SMS', code: '000000' },
              { type: 'EMAIL', code: '000000' },
            ],
          },
        },
        SERVICE,
      );
      expect(body.errors![0].code).toBe('OPERATION_USED-010');
    });
  });

  describe('unauthed-флоу: регистрация', () => {
    it('signup на незнакомый номер: код уходит, verify возвращает identity', async () => {
      const identity = '+7 999 000-11-22';
      const sendBody = await gql(
        SEND_TWO_FA,
        { input: { method: 'signup', identity } },
        { 'x-client-ip': '10.0.0.1' },
      );
      expect(sendBody.errors).toBeUndefined();
      const operationId = sendBody.data!.sendTwoFa.operationId as string;

      const verifyBody = await gql(
        VERIFY_TWO_FA,
        {
          input: {
            operationId,
            method: 'signup',
            codes: [{ type: 'SMS', code: codeFor(operationId, 'sms') }],
          },
        },
        SERVICE,
      );
      expect(verifyBody.data!.verifyTwoFa).toEqual({
        verified: true,
        required: null,
        userId: null,
        identity: '+79990001122',
      });
    });
  });

  describe('verifyTwoFa без operationId — форма { required }', () => {
    it('покрытый метод authed-юзера → required: true', async () => {
      const body = await gql(
        VERIFY_TWO_FA,
        { input: { method: 'transfer', userId: USER_ID } },
        SERVICE,
      );
      expect(body.data!.verifyTwoFa.required).toBe(true);
    });

    it('неизвестный метод → required: false', async () => {
      const body = await gql(
        VERIFY_TWO_FA,
        { input: { method: 'ghost-method' } },
        SERVICE,
      );
      expect(body.data!.verifyTwoFa.required).toBe(false);
    });

    it('required по identity учитывает настройки юзера', async () => {
      const before = await gql(
        VERIFY_TWO_FA,
        { input: { method: 'signin', identity: EMAIL_IDENTITY } },
        SERVICE,
      );
      expect(before.data!.verifyTwoFa.required).toBe(true);

      // юзер отключает 2ФА на signin
      const updated = await gql(
        `mutation($input: UpdateMyMethodsInput!) {
          updateMyTwoFaMethod(input: $input) { id isActive types }
        }`,
        {
          input: {
            methods: [{ id: methodIds.signin, isActive: false, types: [] }],
          },
        },
        AUTHED,
      );
      expect(updated.errors).toBeUndefined();

      const after = await gql(
        VERIFY_TWO_FA,
        { input: { method: 'signin', identity: EMAIL_IDENTITY } },
        SERVICE,
      );
      expect(after.data!.verifyTwoFa.required).toBe(false);
    });
  });

  describe('myTwoFaMethods — настройки юзера', () => {
    const MY_METHODS = `{
      myTwoFaMethods { id method isEnabled allowedTypes enabledTypes tags }
    }`;

    it('выключенный signin остаётся в списке, в twoFaMethods его нет', async () => {
      // signin выключен юзером в предыдущем тесте
      const body = await gql(MY_METHODS, undefined, AUTHED);
      expect(body.errors).toBeUndefined();
      const byName = new Map(
        (body.data!.myTwoFaMethods as Array<{ method: string }>).map((view) => [
          view.method,
          view,
        ]),
      );

      expect(byName.get('signin')).toEqual({
        id: methodIds.signin,
        method: 'signin',
        isEnabled: false,
        allowedTypes: ['email'],
        enabledTypes: [],
        tags: ['unauthed', 'user'],
      });
      expect(byName.get('transfer')).toMatchObject({
        isEnabled: true,
        allowedTypes: ['email', 'sms'],
      });
      // system-метод signup юзеру не настраивается — его в списке нет
      expect(byName.has('signup')).toBe(false);

      const effective = await gql(
        `{ twoFaMethods { methods { method } } }`,
        undefined,
        AUTHED,
      );
      expect(
        (effective.data!.twoFaMethods.methods as Array<{ method: string }>)
          .map((view) => view.method)
          .sort(),
      ).not.toContain('signin');
    });

    it('после включения обратно isEnabled: true и метод снова в twoFaMethods', async () => {
      const updated = await gql(
        `mutation($input: UpdateMyMethodsInput!) {
          updateMyTwoFaMethod(input: $input) { id isActive types }
        }`,
        {
          input: {
            methods: [
              { id: methodIds.signin, isActive: true, types: ['EMAIL'] },
            ],
          },
        },
        AUTHED,
      );
      expect(updated.errors).toBeUndefined();

      const body = await gql(MY_METHODS, undefined, AUTHED);
      const signin = (
        body.data!.myTwoFaMethods as Array<{
          method: string;
          isEnabled: boolean;
          enabledTypes: string[];
        }>
      ).find((view) => view.method === 'signin');
      expect(signin).toMatchObject({
        isEnabled: true,
        enabledTypes: ['email'],
      });

      const effective = await gql(
        `{ twoFaMethods { methods { method } } }`,
        undefined,
        AUTHED,
      );
      expect(
        (effective.data!.twoFaMethods.methods as Array<{ method: string }>).map(
          (view) => view.method,
        ),
      ).toContain('signin');
    });
  });

  describe('общий переключатель default-методов', () => {
    const UPDATE_DEFAULTS = `mutation($input: UpdateMyTwoFaDefaultsInput!) {
      updateMyTwoFaDefaults(input: $input) { defaultMethodsEnabled }
    }`;

    it('админ создаёт default-метод withdraw — юзер видит его как GLOBAL', async () => {
      const created = await gql(
        CREATE_METHODS,
        {
          input: {
            methods: [
              { method: 'withdraw', types: ['SMS'], tags: ['DEFAULT'] },
            ],
          },
        },
        ADMIN,
      );
      expect(created.errors).toBeUndefined();
      methodIds.withdraw = (
        created.data!.createTwoFaMethod as Array<{ id: string }>
      )[0].id;

      const settings = await gql(
        `{ myTwoFaSettings { defaultMethodsEnabled } }`,
        undefined,
        AUTHED,
      );
      expect(settings.data!.myTwoFaSettings.defaultMethodsEnabled).toBe(true);

      const mine = await gql(
        `{ myTwoFaMethods { method isEnabled managedBy enabledTypes } }`,
        undefined,
        AUTHED,
      );
      expect(
        (mine.data!.myTwoFaMethods as Array<{ method: string }>).find(
          (view) => view.method === 'withdraw',
        ),
      ).toEqual({
        method: 'withdraw',
        isEnabled: true,
        managedBy: 'GLOBAL',
        enabledTypes: ['sms'],
      });
    });

    it('default-метод нельзя редактировать индивидуально', async () => {
      const body = await gql(
        `mutation($input: UpdateMyMethodsInput!) {
          updateMyTwoFaMethod(input: $input) { id }
        }`,
        { input: { methods: [{ id: methodIds.withdraw, isActive: false }] } },
        AUTHED,
      );
      expect(body.errors![0].code).toBe('METHOD_NOT_CONFIGURABLE-017');
    });

    it('выключение рубильника гасит withdraw; user/system-методы не тронуты', async () => {
      const off = await gql(
        UPDATE_DEFAULTS,
        { input: { isEnabled: false } },
        AUTHED,
      );
      expect(off.data!.updateMyTwoFaDefaults.defaultMethodsEnabled).toBe(false);

      const required = await gql(
        VERIFY_TWO_FA,
        { input: { method: 'withdraw', userId: USER_ID } },
        SERVICE,
      );
      expect(required.data!.verifyTwoFa.required).toBe(false);

      const effective = await gql(
        `{ twoFaMethods { methods { method } } }`,
        undefined,
        AUTHED,
      );
      const names = (
        effective.data!.twoFaMethods.methods as Array<{ method: string }>
      ).map((view) => view.method);
      expect(names).not.toContain('withdraw');
      expect(names).toContain('transfer');

      // в настройках метод остался — с выключенным состоянием
      const mine = await gql(
        `{ myTwoFaMethods { method isEnabled } }`,
        undefined,
        AUTHED,
      );
      expect(
        (mine.data!.myTwoFaMethods as Array<{ method: string }>).find(
          (view) => view.method === 'withdraw',
        ),
      ).toMatchObject({ isEnabled: false });
    });

    it('включение обратно возвращает требование 2ФА', async () => {
      await gql(UPDATE_DEFAULTS, { input: { isEnabled: true } }, AUTHED);

      const required = await gql(
        VERIFY_TWO_FA,
        { input: { method: 'withdraw', userId: USER_ID } },
        SERVICE,
      );
      expect(required.data!.verifyTwoFa.required).toBe(true);
    });

    it('фильтры myTwoFaMethods: managedBy, isEnabled, tags', async () => {
      // состояние: transfer/signin (user, вкл), withdraw (default, вкл)
      const globalOnly = await gql(
        `{ myTwoFaMethods(input: { managedBy: [GLOBAL] }) { method } }`,
        undefined,
        AUTHED,
      );
      expect(
        (globalOnly.data!.myTwoFaMethods as Array<{ method: string }>).map(
          (view) => view.method,
        ),
      ).toEqual(['withdraw']);

      const enabledUserTagged = await gql(
        `query($input: MyTwoFaMethodsInput) {
          myTwoFaMethods(input: $input) { method }
        }`,
        { input: { isEnabled: true, tags: ['USER'] } },
        AUTHED,
      );
      expect(
        (enabledUserTagged.data!.myTwoFaMethods as Array<{ method: string }>)
          .map((view) => view.method)
          .sort(),
      ).toEqual(['signin', 'transfer']);

      const bySmsAllowed = await gql(
        `{ myTwoFaMethods(input: { allowedTypes: [SMS, EMAIL] }) { method } }`,
        undefined,
        AUTHED,
      );
      expect(
        (bySmsAllowed.data!.myTwoFaMethods as Array<{ method: string }>).map(
          (view) => view.method,
        ),
      ).toEqual(['transfer']);
    });
  });
});
