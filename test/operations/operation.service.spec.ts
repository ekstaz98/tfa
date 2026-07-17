import { Logger } from '@nestjs/common';
import { Operation, OperationStatus } from '../../src/database/entities';
import { TwoFaError } from '../../src/errors';
import { OperationService } from '../../src/operations/services';
import { OperationsTestBed, buildTestBed } from './setup';

const CORE_USER = 'core-user-1';

describe('OperationService.sendTwoFa', () => {
  let bed: OperationsTestBed;
  let service: OperationService;

  beforeEach(() => {
    bed = buildTestBed();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    service = new OperationService(
      bed.config,
      bed.ds,
      bed.crud.methods as any,
      bed.crud.methodTypes as any,
      bed.crud.methodTags as any,
      bed.crud.tags as any,
      bed.crud.types as any,
      bed.crud.users as any,
      bed.crud.credentials as any,
      bed.crud.operations as any,
      bed.crud.codes as any,
      bed.effectiveMethods,
      bed.codeGenerator,
      bed.normalizer,
      bed.masker,
      bed.verifierRegistry,
      bed.publisher,
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

  function setupAuthedTransfer() {
    bed.addMethod('transfer', ['sms', 'email'], ['user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'sms', '+79123453345');
    bed.addCredential(user, 'email', 'ggabchm@gmail.com');
    return user;
  }

  it('happy path (sms+email, authed): операция, коды, события, маски', async () => {
    const user = setupAuthedTransfer();

    const result = await service.sendTwoFa({
      method: 'transfer',
      actor: { userId: CORE_USER },
    });

    expect(result.operationId).toBeDefined();
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
    const operation = bed.crud.operations.rows[0];
    expect(operation.userId).toBe(user.id);
    expect(operation.identity).toBeNull();
    expect(operation.status).toBe(OperationStatus.Pending);
    expect(bed.crud.codes.rows).toHaveLength(2);
    expect(bed.crud.codes.rows.every((row) => row.codeHash !== null)).toBe(
      true,
    );
    // коды в событиях — plaintext, в базе — только хэш
    expect(bed.publisher.events).toHaveLength(2);
    for (const event of bed.publisher.events) {
      expect(event.event).toBe('TFA_OTP');
      expect(event.data.data.code).toMatch(/^\d{6}$/);
      expect(event.data.data.operationId).toBe(result.operationId);
    }
    const providers = bed.publisher.events.map(
      (event) => event.data.destination.providerName,
    );
    expect(providers.sort()).toEqual(['sms', 'smtp']);
  });

  it('публикация происходит после коммита транзакции', async () => {
    setupAuthedTransfer();

    await service.sendTwoFa({
      method: 'transfer',
      actor: { userId: CORE_USER },
    });

    expect(bed.publisher.publishedInTransaction).toEqual([false, false]);
  });

  it('ошибка публикации не роняет sendTwoFa (fire-and-forget)', async () => {
    setupAuthedTransfer();
    bed.publisher.failWith = new Error('events service down');
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const result = await service.sendTwoFa({
      method: 'transfer',
      actor: { userId: CORE_USER },
    });
    await new Promise(setImmediate);

    expect(result.operationId).toBeDefined();
    expect(errorSpy).toHaveBeenCalled();
    // код не попадает в логи
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/\d{6}/);
    errorSpy.mockRestore();
  });

  it('GA: строка кода без хэша, без события, null-поля в ответе', async () => {
    bed.addMethod('withdraw', ['ga'], ['user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'ga', 'ga-identity', { secret: '1:x:y:z' });

    const result = await service.sendTwoFa({
      method: 'withdraw',
      actor: { userId: CORE_USER },
    });

    expect(result.types).toEqual([
      { type: 'ga', identity: null, expire: null, retry: null },
    ]);
    expect(bed.crud.codes.rows[0].codeHash).toBeNull();
    expect(bed.crud.codes.rows[0].lastSentAt).toBeNull();
    expect(bed.publisher.events).toHaveLength(0);
  });

  it('неизвестный метод → UNKNOWN_METHOD-002', () =>
    expectCode(
      service.sendTwoFa({ method: 'ghost', actor: { userId: CORE_USER } }),
      'UNKNOWN_METHOD-002',
    ));

  it('unauthed на метод без тега unauthed → WRONG_METHOD-003', async () => {
    bed.addMethod('transfer', ['sms'], ['user']);
    await expectCode(
      service.sendTwoFa({
        method: 'transfer',
        actor: { identity: '+79123453345' },
      }),
      'WRONG_METHOD-003',
    );
  });

  it('регистрационный метод (system+unauthed): код реально уходит на незнакомый identity', async () => {
    bed.addMethod('signup', ['sms'], ['system', 'unauthed']);

    const result = await service.sendTwoFa({
      method: 'signup',
      actor: { identity: '8 (912) 345-33-45', clientIp: '1.2.3.4' },
      locale: 'ru',
    });

    expect(bed.publisher.events).toHaveLength(1);
    // identity нормализован в E.164, локаль прокинута
    expect(bed.publisher.events[0].data.destination.address).toBe(
      '+89123453345',
    );
    expect(bed.publisher.events[0].data.data.locale).toBe('ru');
    const operation = bed.crud.operations.rows[0];
    expect(operation.userId).toBeNull();
    expect(operation.identity).toBe('+89123453345');
    expect(operation.clientIp).toBe('1.2.3.4');
    expect(result.types[0].identity).toBe('+8912...3345');
  });

  it('signin: неизвестный identity → операция-пустышка, неотличимая снаружи', async () => {
    bed.addMethod('signin', ['email'], ['unauthed', 'user']);

    const result = await service.sendTwoFa({
      method: 'signin',
      actor: { identity: 'random@mail.com' },
    });

    // снаружи — как настоящая
    expect(result.operationId).toBeDefined();
    expect(result.types).toEqual([
      { type: 'email', identity: 'ra...om@mail.com', expire: 300, retry: 120 },
    ]);
    // внутри — реальные строки, но событие не публикуется
    expect(bed.crud.operations.rows).toHaveLength(1);
    expect(bed.crud.operations.rows[0].userId).toBeNull();
    expect(bed.crud.codes.rows[0].codeHash).not.toBeNull();
    expect(bed.publisher.events).toHaveLength(0);
  });

  it('signin: неподтверждённый identity → тоже пустышка', async () => {
    bed.addMethod('signin', ['email'], ['unauthed', 'user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'email', 'a@b.com', { isConfirmed: false });

    await service.sendTwoFa({
      method: 'signin',
      actor: { identity: 'a@b.com' },
    });

    expect(bed.publisher.events).toHaveLength(0);
    expect(bed.crud.operations.rows).toHaveLength(1);
  });

  it('unauthed непокрытый метод (юзер отключил 2ФА) → пустышка вместо ошибки', async () => {
    const signin = bed.addMethod('signin', ['email'], ['unauthed', 'user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'email', 'a@b.com');
    // юзер выключил 2ФА на signin
    const override = bed.crud.userMethods.seed({
      userId: user.id,
      methodId: signin.id,
      isActive: false,
    });
    void override;

    const result = await service.sendTwoFa({
      method: 'signin',
      actor: { identity: 'a@b.com' },
    });

    expect(result.types).toHaveLength(1); // как у любой другой операции
    expect(bed.publisher.events).toHaveLength(0);
    expect(bed.crud.operations.rows).toHaveLength(1);
  });

  it('authed непокрытый метод → METHOD_NOT_COVERED-016', async () => {
    const transfer = bed.addMethod('transfer', ['sms'], ['user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'sms', '+79123453345');
    bed.crud.userMethods.seed({
      userId: user.id,
      methodId: transfer.id,
      isActive: false,
    });

    await expectCode(
      service.sendTwoFa({ method: 'transfer', actor: { userId: CORE_USER } }),
      'METHOD_NOT_COVERED-016',
    );
  });

  it('authed без подтверждённого креда → UNKNOWN_IDENTITY-015, операция не создаётся', async () => {
    bed.addMethod('transfer', ['email'], ['user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'email', 'a@b.com', { isConfirmed: false });

    await expectCode(
      service.sendTwoFa({ method: 'transfer', actor: { userId: CORE_USER } }),
      'UNKNOWN_IDENTITY-015',
    );
    expect(bed.crud.operations.rows).toHaveLength(0);
  });

  describe('лимиты', () => {
    it('дневной лимит «актор × метод» под advisory lock → OPERATIONS_LIMIT-013', async () => {
      const transfer = setupAuthedTransferMethod();
      const user = bed.crud.users.rows[0];
      // уже 2 операции за сутки (лимит 2)
      for (let i = 0; i < 2; i += 1) {
        bed.crud.operations.seed({
          userId: user.id,
          methodId: transfer.id,
          status: OperationStatus.Pending,
          createdAt: new Date(),
        } as Partial<Operation>);
      }

      await expectCode(
        service.sendTwoFa({ method: 'transfer', actor: { userId: CORE_USER } }),
        'OPERATIONS_LIMIT-013',
      );
      const lockCalls = bed.ds.managerMock.query.mock.calls.filter(
        (call: unknown[]) => String(call[0]).includes('pg_advisory_xact_lock'),
      );
      expect(lockCalls.length).toBeGreaterThan(0);
    });

    it('пустышки учитываются в дневном лимите', async () => {
      const signin = bed.addMethod('signin', ['email'], ['unauthed', 'user']);
      void signin;
      // две пустышки на этот identity уже созданы
      await service.sendTwoFa({
        method: 'signin',
        actor: { identity: 'ghost@mail.com' },
      });
      await service.sendTwoFa({
        method: 'signin',
        actor: { identity: 'ghost@mail.com' },
      });
      // fake create не проставляет createdAt — проставим для подсчёта окна
      for (const row of bed.crud.operations.rows) {
        row.createdAt = new Date();
      }

      await expectCode(
        service.sendTwoFa({
          method: 'signin',
          actor: { identity: 'ghost@mail.com' },
        }),
        'OPERATIONS_LIMIT-013',
      );
    });

    it('часовой IP-лимит ловит ротацию identity → IP_LIMIT-014', async () => {
      bed.addMethod('signup', ['sms'], ['system', 'unauthed']);
      await service.sendTwoFa({
        method: 'signup',
        actor: { identity: '+79000000001', clientIp: '9.9.9.9' },
      });
      await service.sendTwoFa({
        method: 'signup',
        actor: { identity: '+79000000002', clientIp: '9.9.9.9' },
      });
      for (const row of bed.crud.operations.rows) {
        row.createdAt = new Date();
      }

      await expectCode(
        service.sendTwoFa({
          method: 'signup',
          actor: { identity: '+79000000003', clientIp: '9.9.9.9' },
        }),
        'IP_LIMIT-014',
      );
    });
  });

  describe('переотправка (x-2fa-operationId)', () => {
    async function createTransferOperation() {
      setupAuthedTransfer();
      const result = await service.sendTwoFa({
        method: 'transfer',
        actor: { userId: CORE_USER },
      });
      bed.publisher.events = [];
      return result.operationId;
    }

    function agePastRetry(operationId: string) {
      for (const row of bed.crud.codes.rows) {
        if (row.operationId === operationId && row.lastSentAt) {
          row.lastSentAt = new Date(Date.now() - 121_000);
        }
      }
    }

    it('до истечения retry-окна → RETRY_NOT_AVAILABLE-011', async () => {
      const operationId = await createTransferOperation();

      await expectCode(
        service.sendTwoFa({
          method: 'transfer',
          actor: { userId: CORE_USER },
          operationId,
        }),
        'RETRY_NOT_AVAILABLE-011',
      );
    });

    it('после retry-окна: UPDATE строки, sends_count+1, attempts не сброшен', async () => {
      const operationId = await createTransferOperation();
      agePastRetry(operationId);
      const smsRow = bed.crud.codes.rows.find(
        (row) => row.typeId === 'type-sms',
      );
      smsRow!.attempts = 1; // юзер уже ошибался
      const oldHash = smsRow!.codeHash;
      const rowsBefore = bed.crud.codes.rows.length;

      const result = await service.sendTwoFa({
        method: 'transfer',
        actor: { userId: CORE_USER },
        operationId,
      });

      expect(result.operationId).toBe(operationId);
      expect(bed.crud.codes.rows).toHaveLength(rowsBefore); // UPDATE, не INSERT
      expect(smsRow!.codeHash).not.toBe(oldHash);
      expect(smsRow!.sendsCount).toBe(2);
      expect(smsRow!.attempts).toBe(1); // не сброшен — иначе бесконечный брутфорс
      expect(bed.publisher.events).toHaveLength(2);
    });

    it('подмножество types: переотправляется только sms, email не тронут', async () => {
      const operationId = await createTransferOperation();
      agePastRetry(operationId);
      const emailRow = bed.crud.codes.rows.find(
        (row) => row.typeId === 'type-email',
      );
      const emailHash = emailRow!.codeHash;

      await service.sendTwoFa({
        method: 'transfer',
        actor: { userId: CORE_USER },
        operationId,
        types: ['sms'],
      });

      expect(emailRow!.codeHash).toBe(emailHash);
      expect(emailRow!.sendsCount).toBe(1);
      expect(bed.publisher.events).toHaveLength(1);
      expect(bed.publisher.events[0].data.destination.providerName).toBe('sms');
    });

    it('сверх лимита переотправок → RESEND_LIMIT-012', async () => {
      const operationId = await createTransferOperation();
      agePastRetry(operationId);
      for (const row of bed.crud.codes.rows) {
        row.sendsCount = 2; // лимит 2 уже выбран
      }

      await expectCode(
        service.sendTwoFa({
          method: 'transfer',
          actor: { userId: CORE_USER },
          operationId,
        }),
        'RESEND_LIMIT-012',
      );
    });

    it('GA в подмножестве types → ошибка (переотправлять нечего)', async () => {
      bed.addMethod('withdraw', ['ga', 'sms'], ['user']);
      const user = bed.addUser(CORE_USER);
      bed.addCredential(user, 'sms', '+79123453345');
      bed.addCredential(user, 'ga', 'ga-id', { secret: '1:x:y:z' });
      const { operationId } = await service.sendTwoFa({
        method: 'withdraw',
        actor: { userId: CORE_USER },
      });

      await expectCode(
        service.sendTwoFa({
          method: 'withdraw',
          actor: { userId: CORE_USER },
          operationId,
          types: ['ga'],
        }),
        'UNKNOWN_TYPE-004',
      );
    });

    it('чужая операция (другой юзер) → UNKNOWN_OPERATION-008', async () => {
      const operationId = await createTransferOperation();
      const stranger = bed.addUser('core-user-2');
      bed.addCredential(stranger, 'sms', '+79999999999');
      bed.addCredential(stranger, 'email', 'x@y.com');

      await expectCode(
        service.sendTwoFa({
          method: 'transfer',
          actor: { userId: 'core-user-2' },
          operationId,
        }),
        'UNKNOWN_OPERATION-008',
      );
    });

    it('истёкшая операция → OPERATION_EXPIRED-009 и статус expired', async () => {
      const operationId = await createTransferOperation();
      const operation = bed.crud.operations.rows[0];
      operation.expiresAt = new Date(Date.now() - 1000);

      await expectCode(
        service.sendTwoFa({
          method: 'transfer',
          actor: { userId: CORE_USER },
          operationId,
        }),
        'OPERATION_EXPIRED-009',
      );
      expect(operation.status).toBe(OperationStatus.Expired);
    });

    it('переотправка пустышки отрабатывает штатно и без публикации', async () => {
      bed.addMethod('signin', ['email'], ['unauthed', 'user']);
      const { operationId } = await service.sendTwoFa({
        method: 'signin',
        actor: { identity: 'ghost@mail.com' },
      });
      agePastRetry(operationId);
      const row = bed.crud.codes.rows[0];
      const oldHash = row.codeHash;

      const result = await service.sendTwoFa({
        method: 'signin',
        actor: { identity: 'ghost@mail.com' },
        operationId,
      });

      expect(result.operationId).toBe(operationId);
      expect(row.codeHash).not.toBe(oldHash);
      expect(row.sendsCount).toBe(2);
      expect(bed.publisher.events).toHaveLength(0);
    });
  });

  function setupAuthedTransferMethod() {
    const transfer = bed.addMethod('transfer', ['sms', 'email'], ['user']);
    const user = bed.addUser(CORE_USER);
    bed.addCredential(user, 'sms', '+79123453345');
    bed.addCredential(user, 'email', 'ggabchm@gmail.com');
    return transfer;
  }
});
