import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MethodsCrudService } from '../database/crud';
import {
  GATEWAY_METHODS_PORT,
  GatewayMethodsPort,
} from './gateway-methods.port';

export interface MethodsSyncResult {
  created: string[];
  deactivated: string[];
}

/**
 * updateListMethods (service-роль): автосинк методов из схемы гейтвея.
 * Исчезнувший метод → is_active = false; новый → активный с пустыми
 * types/tags (2ФА не требует и в выдачи не попадает, пока админ не настроит).
 * Вернувшийся метод намеренно НЕ реактивируется — иначе синк перетирал бы
 * ручные отключения админа. Ошибка/пустой ответ интроспекции деактивирует
 * все методы — принятый риск скелета.
 */
@Injectable()
export class MethodsSyncService {
  constructor(
    @Inject(GATEWAY_METHODS_PORT)
    private readonly gateway: GatewayMethodsPort,
    private readonly dataSource: DataSource,
    private readonly methodsCrud: MethodsCrudService,
  ) {}

  async updateListMethods(): Promise<MethodsSyncResult> {
    const gatewayNames = new Set(await this.gateway.fetchMethodNames());
    const existing = await this.methodsCrud.findBy({ isDeleted: false });
    const knownNames = new Set(existing.map((method) => method.method));

    const created: string[] = [];
    const deactivated: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      for (const method of existing) {
        if (!gatewayNames.has(method.method) && method.isActive) {
          await this.methodsCrud.update(
            method.id,
            { isActive: false },
            manager,
          );
          deactivated.push(method.method);
        }
      }
      for (const name of gatewayNames) {
        if (!knownNames.has(name)) {
          await this.methodsCrud.create(
            { method: name, isActive: true },
            manager,
          );
          created.push(name);
        }
      }
    });
    return { created, deactivated };
  }
}
