import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

const logger = new Logger('TFAService');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Consumer синхронизации юзеров из интегрирующей системы (обработчики — этап 7).
  // Ack вручную после успешной записи, поэтому noAck: false.
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [config.getOrThrow<string>('rmq.url')],
        queue: config.getOrThrow<string>('rmq.usersQueue'),
        noAck: false,
        queueOptions: { durable: true },
      },
    },
    { inheritAppConfig: true },
  );

  const port = config.getOrThrow<number>('port');
  const host = config.getOrThrow<string>('host');

  await app.startAllMicroservices();
  await app.listen(port, host, () =>
    logger.log(`Server running at ${host}:${port}`),
  );
}

void bootstrap();
