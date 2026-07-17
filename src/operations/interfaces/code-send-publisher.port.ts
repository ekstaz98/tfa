/**
 * Событие отправки кода в формате events-сервиса интегрирующей системы:
 * sendEvent({ event, data: { data, destination } }). Код — plaintext,
 * доставку выполняет внешняя система; шаблоны/тайтлы — не зона 2ФА-сервиса.
 */
export interface CodeSendEvent {
  event: string;
  data: {
    data: {
      code: string;
      sentAt: string;
      operationId: string;
      locale?: string;
    };
    destination: {
      address: string;
      providerName: string;
    };
  };
}

/** Порт отправки: домен не знает про транспорт (DIP). */
export interface CodeSendPublisherPort {
  publish(event: CodeSendEvent): Promise<void>;
}

export const CODE_SEND_PUBLISHER = Symbol('CodeSendPublisherPort');
