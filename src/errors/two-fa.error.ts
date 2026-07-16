import { TWO_FA_ERROR_DEFINITIONS, TwoFaErrorCode } from './two-fa-error-code';

/** Элемент массива errors в ответе — формат из ТЗ. */
export interface TwoFaErrorShape {
  message: string;
  title: string;
  code: string;
  status: number;
}

/**
 * Единственный класс доменных ошибок сервиса. title/status берутся
 * из справочника по коду; message можно уточнить по месту броска.
 */
export class TwoFaError extends Error {
  readonly title: string;
  readonly status: number;

  constructor(
    readonly code: TwoFaErrorCode,
    message?: string,
  ) {
    const definition = TWO_FA_ERROR_DEFINITIONS[code];
    super(message ?? definition.message);
    this.name = 'TwoFaError';
    this.title = definition.title;
    this.status = definition.status;
  }

  toShape(): TwoFaErrorShape {
    return {
      message: this.message,
      title: this.title,
      code: this.code,
      status: this.status,
    };
  }
}
