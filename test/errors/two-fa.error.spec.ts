import {
  TWO_FA_ERROR_DEFINITIONS,
  TwoFaErrorCode,
} from '../../src/errors/two-fa-error-code';
import { TwoFaError } from '../../src/errors/two-fa.error';

describe('TwoFaErrorCode', () => {
  const codes = Object.values(TwoFaErrorCode);

  it('коды из ТЗ присутствуют дословно', () => {
    for (const tzCode of [
      'UNKNOWN_TAG-001',
      'UNKNOWN_METHOD-002',
      'WRONG_METHOD-003',
      'UNKNOWN_TYPE-004',
      'WRONG_METHOD-005',
    ]) {
      expect(codes).toContain(tzCode);
    }
  });

  it('каждый код в формате NAME-NNN', () => {
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z_]+-\d{3}$/);
    }
  });

  it('номера кодов уникальны', () => {
    const numbers = codes.map((code) => code.split('-').pop());
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('у каждого кода есть определение с title, message и валидным status', () => {
    for (const code of codes) {
      const definition = TWO_FA_ERROR_DEFINITIONS[code];
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.message.length).toBeGreaterThan(0);
      expect(definition.status).toBeGreaterThanOrEqual(400);
      expect(definition.status).toBeLessThan(600);
    }
  });
});

describe('TwoFaError', () => {
  it('заполняет message, title, status из справочника по коду', () => {
    const error = new TwoFaError(TwoFaErrorCode.MethodAlreadyExists);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('WRONG_METHOD-005');
    expect(error.title).toBe('Method already exists');
    expect(error.status).toBe(409);
    expect(error.message).toBe(
      'Method with provided name already exists and is not deleted',
    );
  });

  it('message можно уточнить по месту броска', () => {
    const error = new TwoFaError(
      TwoFaErrorCode.UnknownTag,
      'Tag "vip" does not exist',
    );

    expect(error.message).toBe('Tag "vip" does not exist');
    expect(error.code).toBe('UNKNOWN_TAG-001');
  });

  it('toShape отдаёт ровно четыре поля формата ТЗ', () => {
    const shape = new TwoFaError(TwoFaErrorCode.WrongCode).toShape();

    expect(shape).toEqual({
      message: 'Provided 2FA code is not valid',
      title: 'Wrong code',
      code: 'WRONG_CODE-006',
      status: 400,
    });
    expect(Object.keys(shape)).toHaveLength(4);
  });
});
