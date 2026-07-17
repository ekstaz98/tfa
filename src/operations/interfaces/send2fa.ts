export interface SendActor {
  /** core userId авторизованного клиента (из заголовков гейтвея). */
  userId?: string | null;
  /** identity неавторизованного клиента (signin, регистрация). */
  identity?: string | null;
  /** client IP из заголовка гейтвея — опора часового IP-лимита. */
  clientIp?: string | null;
}

export interface Send2FaParams {
  method: string;
  actor: SendActor;
  /** Подмножество типов для переотправки; только вместе с operationId. */
  types?: string[];
  locale?: string;
  /** x-2fa-operationId: переотправка по существующей операции. */
  operationId?: string;
}

export interface Send2FaTypeView {
  type: string;
  identity: string | null;
  expire: number | null;
  retry: number | null;
}

export interface Send2FaResult {
  operationId: string;
  types: Send2FaTypeView[];
}
