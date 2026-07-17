import {
  Code,
  Method,
  Operation,
  OperationStatus,
  User,
} from '../../src/database/entities';
import { TwoFaError } from '../../src/errors';
import {
  currentTimeStep,
  totpCode,
  base32Decode,
} from '../../src/operations/helpers/totp';
import { VerificationService } from '../../src/operations/services';
import { OperationsTestBed, buildTestBed } from './setup';

const CORE_USER = 'core-user-1';
const SMS_CODE = '111111';
const EMAIL_CODE = '222222';
const GA_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('VerificationService.verify', () => {
  let bed: OperationsTestBed;
  let service: VerificationService;
  let user: User;
  let transfer: Method;
  let operation: Operation;

  beforeEach(() => {
    bed = buildTestBed();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    service = new VerificationService(
      bed.config,
      bed.ds,
      bed.crud.methods as any,
      bed.crud.users as any,
      bed.crud.operations as any,
      bed.crud.codes as any,
      bed.crud.types as any,
      bed.verifierRegistry,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
    transfer = bed.addMethod('transfer', ['sms', 'email'], ['user']);
    user = bed.addUser(CORE_USER);
    operation = seedOperation();
  });

  function seedOperation(
    types: Array<{ type: string; code: string | null }> = [
      { type: 'sms', code: SMS_CODE },
      { type: 'email', code: EMAIL_CODE },
    ],
  ): Operation {
    const created = bed.crud.operations.seed({
      userId: user.id,
      methodId: transfer.id,
      identity: null,
      status: OperationStatus.Pending,
      expiresAt: new Date(Date.now() + 300_000),
    } as Partial<Operation>);
    for (const { type, code } of types) {
      bed.crud.codes.seed({
        operationId: created.id,
        typeId: `type-${type}`,
        codeHash: code === null ? null : bed.codeGenerator.hash(code),
        attempts: 0,
        sendsCount: 1,
        lastSentAt: code === null ? null : new Date(),
        verifiedAt: null,
        expiresAt: new Date(Date.now() + 300_000),
      } as Partial<Code>);
    }
    return created;
  }

  function verify(
    codes: Array<{ type: string; code: string }>,
    over: {
      operationId?: string;
      method?: string;
      userId?: string | null;
    } = {},
  ) {
    return service.verify({
      operationId: over.operationId ?? operation.id,
      method: over.method ?? 'transfer',
      userId: over.userId === undefined ? CORE_USER : over.userId,
      codes,
    });
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

  const bothCodes = () => [
    { type: 'sms', code: SMS_CODE },
    { type: 'email', code: EMAIL_CODE },
  ];

  it('happy path: оба кода верны → verified, статус verified, verified_at', async () => {
    const result = await verify(bothCodes());

    expect(result).toEqual({
      verified: true,
      userId: CORE_USER,
      identity: null,
    });
    expect(operation.status).toBe(OperationStatus.Verified);
    expect(bed.crud.codes.rows.every((row) => row.verifiedAt !== null)).toBe(
      true,
    );
  });

  it('неверный код → WRONG_CODE-006, attempts+1 только у неверного', async () => {
    await expectCode(
      verify([
        { type: 'sms', code: '999999' },
        { type: 'email', code: EMAIL_CODE },
      ]),
      'WRONG_CODE-006',
    );
    const sms = bed.crud.codes.rows.find((row) => row.typeId === 'type-sms');
    const email = bed.crud.codes.rows.find(
      (row) => row.typeId === 'type-email',
    );
    expect(sms!.attempts).toBe(1);
    expect(email!.attempts).toBe(0);
    expect(operation.status).toBe(OperationStatus.Pending);
  });

  it('исчерпание попыток по одному типу валит операцию целиком → ATTEMPTS_EXCEEDED-007', async () => {
    // лимит 2: первая ошибка
    await expectCode(
      verify([
        { type: 'sms', code: '999999' },
        { type: 'email', code: EMAIL_CODE },
      ]),
      'WRONG_CODE-006',
    );
    // вторая ошибка — исчерпание, даже при валидном email
    await expectCode(
      verify([
        { type: 'sms', code: '888888' },
        { type: 'email', code: EMAIL_CODE },
      ]),
      'ATTEMPTS_EXCEEDED-007',
    );
    expect(operation.status).toBe(OperationStatus.Failed);

    // операция failed: даже верные коды больше не проходят
    await expectCode(verify(bothCodes()), 'ATTEMPTS_EXCEEDED-007');
  });

  describe('строгая валидация codes[] — отказ без траты попыток', () => {
    it.each([
      [
        'дубль типа',
        [
          { type: 'sms', code: SMS_CODE },
          { type: 'sms', code: SMS_CODE },
          { type: 'email', code: EMAIL_CODE },
        ],
      ],
      [
        'тип не из операции',
        [
          { type: 'sms', code: SMS_CODE },
          { type: 'email', code: EMAIL_CODE },
          { type: 'push', code: '000000' },
        ],
      ],
      ['не все типы покрыты', [{ type: 'sms', code: SMS_CODE }]],
    ])('%s → WRONG_CODE-006 без инкремента', async (_name, codes) => {
      await expectCode(verify(codes), 'WRONG_CODE-006');
      expect(bed.crud.codes.rows.every((row) => row.attempts === 0)).toBe(true);
      expect(operation.status).toBe(OperationStatus.Pending);
    });
  });

  it('истёкшая операция → OPERATION_EXPIRED-009, статус expired', async () => {
    operation.expiresAt = new Date(Date.now() - 1000);

    await expectCode(verify(bothCodes()), 'OPERATION_EXPIRED-009');
    expect(operation.status).toBe(OperationStatus.Expired);
  });

  it('операция одноразовая: повторный verify → OPERATION_USED-010', async () => {
    await verify(bothCodes());
    await expectCode(verify(bothCodes()), 'OPERATION_USED-010');
  });

  it('конкурентный verify не проходит условный UPDATE → OPERATION_USED-010', async () => {
    bed.crud.operations.updateStatusIf.mockResolvedValueOnce(false);
    await expectCode(verify(bothCodes()), 'OPERATION_USED-010');
  });

  it('несуществующая операция → UNKNOWN_OPERATION-008', () =>
    expectCode(
      verify(bothCodes(), { operationId: 'ghost' }),
      'UNKNOWN_OPERATION-008',
    ));

  it('чужой method → UNKNOWN_OPERATION-008 (не палим существование)', async () => {
    bed.addMethod('signin', ['sms'], ['unauthed', 'user']);
    await expectCode(
      verify(bothCodes(), { method: 'signin' }),
      'UNKNOWN_OPERATION-008',
    );
  });

  it('чужой userId → UNKNOWN_OPERATION-008', async () => {
    bed.addUser('core-user-2');
    await expectCode(
      verify(bothCodes(), { userId: 'core-user-2' }),
      'UNKNOWN_OPERATION-008',
    );
  });

  it('unauthed-операция возвращает identity для гейтвея', async () => {
    const unauthedOp = bed.crud.operations.seed({
      userId: user.id,
      methodId: transfer.id,
      identity: 'a@b.com',
      status: OperationStatus.Pending,
      expiresAt: new Date(Date.now() + 300_000),
    } as Partial<Operation>);
    bed.crud.codes.seed({
      operationId: unauthedOp.id,
      typeId: 'type-email',
      codeHash: bed.codeGenerator.hash(EMAIL_CODE),
      attempts: 0,
      sendsCount: 1,
      lastSentAt: new Date(),
      verifiedAt: null,
      expiresAt: new Date(Date.now() + 300_000),
    } as Partial<Code>);

    const result = await service.verify({
      operationId: unauthedOp.id,
      method: 'transfer',
      userId: null,
      codes: [{ type: 'email', code: EMAIL_CODE }],
    });

    expect(result).toEqual({
      verified: true,
      userId: CORE_USER,
      identity: 'a@b.com',
    });
  });

  describe('GA/TOTP', () => {
    let gaOperation: Operation;

    beforeEach(() => {
      bed.addMethod('withdraw', ['ga'], ['user']);
      bed.addCredential(user, 'ga', 'ga-identity', {
        secret: bed.cipher.encrypt(GA_SECRET_BASE32),
      });
      const withdraw = bed.crud.methods.rows.find(
        (row) => row.method === 'withdraw',
      ) as Method;
      gaOperation = bed.crud.operations.seed({
        userId: user.id,
        methodId: withdraw.id,
        identity: null,
        status: OperationStatus.Pending,
        expiresAt: new Date(Date.now() + 300_000),
      } as Partial<Operation>);
      bed.crud.codes.seed({
        operationId: gaOperation.id,
        typeId: 'type-ga',
        codeHash: null,
        attempts: 0,
        sendsCount: 1,
        lastSentAt: null,
        verifiedAt: null,
        expiresAt: new Date(Date.now() + 300_000),
      } as Partial<Code>);
    });

    function currentGaCode(): string {
      return totpCode(base32Decode(GA_SECRET_BASE32), currentTimeStep());
    }

    it('верный TOTP-код проходит, time-step сохраняется', async () => {
      const result = await service.verify({
        operationId: gaOperation.id,
        method: 'withdraw',
        userId: CORE_USER,
        codes: [{ type: 'ga', code: currentGaCode() }],
      });

      expect(result.verified).toBe(true);
      const credential = bed.crud.credentials.rows.find(
        (row) => row.typeId === 'type-ga',
      );
      expect(credential!.lastUsedCounter).toBe(String(currentTimeStep()));
    });

    it('replay того же time-step отклоняется (anti-replay)', async () => {
      const code = currentGaCode();
      await service.verify({
        operationId: gaOperation.id,
        method: 'withdraw',
        userId: CORE_USER,
        codes: [{ type: 'ga', code }],
      });

      // вторая операция в том же окне — тот же код уже не проходит
      const second = bed.crud.operations.seed({
        userId: user.id,
        methodId: gaOperation.methodId,
        identity: null,
        status: OperationStatus.Pending,
        expiresAt: new Date(Date.now() + 300_000),
      } as Partial<Operation>);
      bed.crud.codes.seed({
        operationId: second.id,
        typeId: 'type-ga',
        codeHash: null,
        attempts: 0,
        sendsCount: 1,
        lastSentAt: null,
        verifiedAt: null,
        expiresAt: new Date(Date.now() + 300_000),
      } as Partial<Code>);

      await expectCode(
        service.verify({
          operationId: second.id,
          method: 'withdraw',
          userId: CORE_USER,
          codes: [{ type: 'ga', code }],
        }),
        'WRONG_CODE-006',
      );
    });

    it('неверный TOTP-код → WRONG_CODE-006', () =>
      expectCode(
        service.verify({
          operationId: gaOperation.id,
          method: 'withdraw',
          userId: CORE_USER,
          codes: [{ type: 'ga', code: '000000' }],
        }),
        'WRONG_CODE-006',
      ));
  });

  it('операция-пустышка: любой код → WRONG_CODE (случайный хэш не совпадает)', async () => {
    const dummy = bed.crud.operations.seed({
      userId: null,
      methodId: transfer.id,
      identity: 'ghost@mail.com',
      status: OperationStatus.Pending,
      expiresAt: new Date(Date.now() + 300_000),
    } as Partial<Operation>);
    bed.crud.codes.seed({
      operationId: dummy.id,
      typeId: 'type-email',
      codeHash: bed.codeGenerator.randomHash(),
      attempts: 0,
      sendsCount: 1,
      lastSentAt: new Date(),
      verifiedAt: null,
      expiresAt: new Date(Date.now() + 300_000),
    } as Partial<Code>);

    await expectCode(
      service.verify({
        operationId: dummy.id,
        method: 'transfer',
        userId: null,
        codes: [{ type: 'email', code: '123456' }],
      }),
      'WRONG_CODE-006',
    );
  });
});
