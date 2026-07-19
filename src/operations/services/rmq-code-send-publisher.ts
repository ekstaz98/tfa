import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqplib from 'amqplib';
import { CodeSendEvent, CodeSendPublisherPort } from '../interfaces';

/**
 * Живой транспорт порта отправки: событие кода публикуется в очередь RMQ
 * (её читает events-сервис интегрирующей системы или демо-консьюмер).
 * Включается конфигом sendEvent.transport = 'rmq'; дефолт скелета — мок.
 */
@Injectable()
export class RmqCodeSendPublisher
  implements CodeSendPublisherPort, OnModuleDestroy
{
  private readonly _logger = new Logger(RmqCodeSendPublisher.name);
  private readonly _url: string;
  private readonly _queue: string;
  private _connection: amqplib.ChannelModel | null = null;
  private _channel: amqplib.Channel | null = null;
  private _connecting: Promise<amqplib.Channel> | null = null;

  constructor(config: ConfigService) {
    this._url = config.getOrThrow<string>('rmq.url');
    this._queue = config.getOrThrow<string>('sendEvent.queue');
  }

  async publish(event: CodeSendEvent): Promise<void> {
    const channel = await this._ensureChannel();
    channel.sendToQueue(this._queue, Buffer.from(JSON.stringify(event)), {
      persistent: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this._channel?.close().catch(() => undefined);
    await this._connection?.close().catch(() => undefined);
  }

  /** Ленивое подключение; конкурентные publish ждут один коннект. */
  private _ensureChannel(): Promise<amqplib.Channel> {
    if (this._channel) {
      return Promise.resolve(this._channel);
    }
    this._connecting ??= (async () => {
      try {
        this._connection = await amqplib.connect(this._url);
        this._connection.on('close', () => {
          this._channel = null;
          this._connection = null;
        });
        const channel = await this._connection.createChannel();
        await channel.assertQueue(this._queue, { durable: true });
        this._channel = channel;
        return channel;
      } finally {
        this._connecting = null;
      }
    })();
    return this._connecting;
  }
}
