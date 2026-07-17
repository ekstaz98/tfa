import { Logger } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { UsersSyncController } from '../../src/users-sync/users-sync.controller';
import {
  InvalidUserSyncEventError,
  UsersSyncService,
} from '../../src/users-sync/services';

describe('UsersSyncController (ack/nack)', () => {
  const message = { content: Buffer.from('{}') };
  let channel: { ack: jest.Mock; nack: jest.Mock };
  let context: RmqContext;
  let service: { parseEvent: jest.Mock; syncUser: jest.Mock };
  let controller: UsersSyncController;

  beforeEach(() => {
    channel = { ack: jest.fn(), nack: jest.fn() };
    context = new RmqContext([message, channel, 'user.sync'] as never);
    service = {
      parseEvent: jest.fn((payload: unknown) => payload),
      syncUser: jest.fn().mockResolvedValue(undefined),
    };
    controller = new UsersSyncController(
      service as unknown as UsersSyncService,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('успешная запись → ack', async () => {
    await controller.handleUserSync({ userId: 'u', credentials: [] }, context);

    expect(service.syncUser).toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('ошибка записи → nack с requeue (без DLQ)', async () => {
    service.syncUser.mockRejectedValue(new Error('db down'));

    await controller.handleUserSync({ userId: 'u', credentials: [] }, context);

    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('битый payload → ack (дроп, не вечный requeue-цикл)', async () => {
    service.parseEvent.mockImplementation(() => {
      throw new InvalidUserSyncEventError('bad payload');
    });

    await controller.handleUserSync('garbage', context);

    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
    expect(service.syncUser).not.toHaveBeenCalled();
  });
});
