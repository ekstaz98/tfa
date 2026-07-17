import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { USER_SYNC_EVENT } from './interfaces';
import { InvalidUserSyncEventError, UsersSyncService } from './services';

interface AckChannel {
  ack(message: unknown): void;
  nack(message: unknown, allUpTo: boolean, requeue: boolean): void;
}

/**
 * Тонкий RMQ-контроллер: парсинг + ack. Ack — только после успешной записи;
 * ошибка обработки → nack с requeue (DLQ-обвязки в скелете нет);
 * битый payload подтверждается и логируется — requeue дал бы вечный цикл.
 */
@Controller()
export class UsersSyncController {
  private readonly _logger = new Logger(UsersSyncController.name);

  constructor(private readonly _usersSyncService: UsersSyncService) {}

  @EventPattern(USER_SYNC_EVENT)
  async handleUserSync(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as AckChannel;
    const message = context.getMessage();
    try {
      const event = this._usersSyncService.parseEvent(payload);
      await this._usersSyncService.syncUser(event);
      channel.ack(message);
    } catch (error) {
      if (error instanceof InvalidUserSyncEventError) {
        this._logger.warn(
          `Malformed user sync event dropped: ${error.message}`,
        );
        channel.ack(message);
        return;
      }
      this._logger.error(
        `User sync failed, message requeued: ${(error as Error).message}`,
      );
      channel.nack(message, false, true);
    }
  }
}
