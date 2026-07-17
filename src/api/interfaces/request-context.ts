/**
 * Заголовки от гейтвея. Реальная авторизация — на гейтвее (вне скоупа),
 * сервис доверяет заголовкам; guards — заглушки по ролям.
 */
export const HEADER_USER_ID = 'x-user-id';
export const HEADER_ROLES = 'x-roles';
export const HEADER_CLIENT_IP = 'x-client-ip';
export const HEADER_OPERATION_ID = 'x-2fa-operationid';

export const ROLE_ADMIN = 'admin';
export const ROLE_SERVICE = 'service';

export interface RequestContext {
  /** core userId авторизованного клиента; null для unauthed. */
  userId: string | null;
  roles: string[];
  clientIp: string | null;
  /** x-2fa-operationId — переотправка кодов существующей операции. */
  operationId: string | null;
}
