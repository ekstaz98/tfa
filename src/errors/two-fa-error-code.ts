/**
 * Коды ошибок в формате ТЗ: NAME-NNN.
 * 001–005 — фиксированы ТЗ, 006+ — скелетные (продолжение нумерации).
 */
export enum TwoFaErrorCode {
  /** Неизвестный тег. */
  UnknownTag = 'UNKNOWN_TAG-001',
  /** Неизвестный метод. */
  UnknownMethod = 'UNKNOWN_METHOD-002',
  /** Неавторизованный клиент вызывает метод без тега unauthed. */
  MethodNotAllowedUnauthed = 'WRONG_METHOD-003',
  /** Неизвестный тип 2ФА. */
  UnknownType = 'UNKNOWN_TYPE-004',
  /** Метод с таким именем уже есть и не удалён. */
  MethodAlreadyExists = 'WRONG_METHOD-005',
  /** Неверный код. */
  WrongCode = 'WRONG_CODE-006',
  /** Исчерпан лимит попыток ввода — операция целиком failed. */
  AttemptsExceeded = 'ATTEMPTS_EXCEEDED-007',
  /**
   * Операция не найдена. Тот же код отдаётся при несовпадении привязки
   * verify (чужой method/userId) — существование чужих операций не палим.
   */
  UnknownOperation = 'UNKNOWN_OPERATION-008',
  /** Операция истекла. */
  OperationExpired = 'OPERATION_EXPIRED-009',
  /** Операция уже использована (verify одноразовый). */
  OperationAlreadyUsed = 'OPERATION_USED-010',
  /** Переотправка раньше retry-окна. */
  RetryNotAvailable = 'RETRY_NOT_AVAILABLE-011',
  /** Исчерпан лимит переотправок кода. */
  ResendLimitExceeded = 'RESEND_LIMIT-012',
  /** Дневной лимит операций на «актор × метод». */
  DailyOperationsLimitExceeded = 'OPERATIONS_LIMIT-013',
  /** Часовой лимит unauthed-операций с одного IP. */
  IpLimitExceeded = 'IP_LIMIT-014',
  /** Identity не найден или канал не подтверждён. */
  IdentityNotFound = 'UNKNOWN_IDENTITY-015',
  /** Метод не покрыт 2ФА для этого актора (0 эффективных типов). */
  MethodNotCovered = 'METHOD_NOT_COVERED-016',
  /** Метод не настраивается юзером (нет тега user). */
  MethodNotConfigurable = 'METHOD_NOT_CONFIGURABLE-017',
  /** system-метод нельзя выключить/удалить/лишить типов. */
  SystemMethodLocked = 'SYSTEM_METHOD_LOCKED-018',
  /** Конфликт режимных тегов (system | default | user — не больше одного). */
  ModeTagsConflict = 'TAGS_CONFLICT-019',
}

export interface TwoFaErrorDefinition {
  title: string;
  message: string;
  status: number;
}

export const TWO_FA_ERROR_DEFINITIONS: Record<
  TwoFaErrorCode,
  TwoFaErrorDefinition
> = {
  [TwoFaErrorCode.UnknownTag]: {
    title: 'Unknown tag',
    message: 'Provided tag does not exist',
    status: 400,
  },
  [TwoFaErrorCode.UnknownMethod]: {
    title: 'Unknown method',
    message: 'Provided method does not exist',
    status: 404,
  },
  [TwoFaErrorCode.MethodNotAllowedUnauthed]: {
    title: 'Method not allowed',
    message: 'Method is not available for unauthenticated clients',
    status: 403,
  },
  [TwoFaErrorCode.UnknownType]: {
    title: 'Unknown type',
    message: 'Provided 2FA type does not exist',
    status: 400,
  },
  [TwoFaErrorCode.MethodAlreadyExists]: {
    title: 'Method already exists',
    message: 'Method with provided name already exists and is not deleted',
    status: 409,
  },
  [TwoFaErrorCode.WrongCode]: {
    title: 'Wrong code',
    message: 'Provided 2FA code is not valid',
    status: 400,
  },
  [TwoFaErrorCode.AttemptsExceeded]: {
    title: 'Attempts exceeded',
    message: '2FA attempts limit is exceeded, operation is failed',
    status: 403,
  },
  [TwoFaErrorCode.UnknownOperation]: {
    title: 'Operation not found',
    message: 'Operation does not exist',
    status: 404,
  },
  [TwoFaErrorCode.OperationExpired]: {
    title: 'Operation expired',
    message: 'Operation lifetime is over',
    status: 410,
  },
  [TwoFaErrorCode.OperationAlreadyUsed]: {
    title: 'Operation already used',
    message: 'Operation has already been verified',
    status: 409,
  },
  [TwoFaErrorCode.RetryNotAvailable]: {
    title: 'Retry not available',
    message: 'Code was sent recently, retry window is not over yet',
    status: 429,
  },
  [TwoFaErrorCode.ResendLimitExceeded]: {
    title: 'Resend limit exceeded',
    message: 'Code resend limit for the operation is exceeded',
    status: 429,
  },
  [TwoFaErrorCode.DailyOperationsLimitExceeded]: {
    title: 'Operations limit exceeded',
    message: 'Daily operations limit for the method is exceeded',
    status: 429,
  },
  [TwoFaErrorCode.IpLimitExceeded]: {
    title: 'Too many requests',
    message: 'Hourly operations limit for the client IP is exceeded',
    status: 429,
  },
  [TwoFaErrorCode.IdentityNotFound]: {
    title: 'Identity not found',
    message: 'Identity is not found or is not confirmed',
    status: 404,
  },
  [TwoFaErrorCode.MethodNotCovered]: {
    title: 'Method not covered',
    message: 'Method is not covered by 2FA for this actor',
    status: 400,
  },
  [TwoFaErrorCode.MethodNotConfigurable]: {
    title: 'Method not configurable',
    message: 'Method settings cannot be overridden by user',
    status: 403,
  },
  [TwoFaErrorCode.SystemMethodLocked]: {
    title: 'System method',
    message: 'System method cannot be disabled, deleted or left without types',
    status: 403,
  },
  [TwoFaErrorCode.ModeTagsConflict]: {
    title: 'Tags conflict',
    message: 'Method can have at most one mode tag: system | default | user',
    status: 400,
  },
};
