/**
 * Подтверждённый контракт интегрирующей системы: одно и то же событие
 * на создание юзера и обновление его email/phone.
 */
export interface UserSyncCredential {
  /** Имя типа 2ФА из справочника: sms | email | ... */
  type: string;
  identity: string;
}

export interface UserSyncEvent {
  /** id юзера в core-системе. */
  userId: string;
  credentials: UserSyncCredential[];
}

/** pattern RMQ-сообщения (Nest-конверт { pattern, data }). */
export const USER_SYNC_EVENT = 'user.sync';
