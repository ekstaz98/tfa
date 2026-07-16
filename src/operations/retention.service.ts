import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OperationsCrudService } from '../database/crud';

/**
 * Единственный scheduled-джоб: батч-DELETE завершённых/истёкших операций
 * (и их codes по CASCADE) старше периода одним SQL-запросом, без загрузки
 * строк в память. Без него таблицы растут бесконечно — пустышки и пробы
 * это ускоряют.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private readonly retentionDays: number;

  constructor(
    config: ConfigService,
    private readonly operationsCrud: OperationsCrudService,
  ) {
    this.retentionDays = config.getOrThrow<number>('retention.days');
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanup(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.retentionDays * 24 * 60 * 60 * 1000,
    );
    const deleted = await this.operationsCrud.deleteFinishedBefore(cutoff);
    if (deleted > 0) {
      this.logger.log(
        `Retention: deleted ${deleted} operations older than ${this.retentionDays} days`,
      );
    }
    return deleted;
  }
}
