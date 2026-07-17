import { Injectable } from '@nestjs/common';
import { CodeSendEvent, CodeSendPublisherPort } from '../interfaces';

/**
 * Единственная реализация порта в скелете: копит события в памяти,
 * e2e-тесты читают коды отсюда (API чтения кода в сервисе нет).
 * Живой адаптер к events-сервису подключается заменой провайдера
 * CODE_SEND_PUBLISHER — домен не меняется.
 */
@Injectable()
export class MockCodeSendPublisher implements CodeSendPublisherPort {
  readonly events: CodeSendEvent[] = [];

  publish(event: CodeSendEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}
