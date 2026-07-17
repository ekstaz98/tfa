import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MethodsCrudService } from '../../database/crud';
import {
  GATEWAY_METHODS_PORT,
  GatewayMethodsPort,
  MethodsSyncResult,
} from '../interfaces';

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
    private readonly _gateway: GatewayMethodsPort,
    private readonly _dataSource: DataSource,
    private readonly _methodsCrud: MethodsCrudService,
  ) {}

  async updateListMethods(): Promise<MethodsSyncResult> {
    const gatewayNames = new Set(await this._gateway.fetchMethodNames());
    const existing = await this._methodsCrud.findBy({ isDeleted: false });
    const knownNames = new Set(existing.map((method) => method.method));

    const toDeactivate = existing.filter(
      (method) => !gatewayNames.has(method.method) && method.isActive,
    );
    const toCreate = [...gatewayNames].filter((name) => !knownNames.has(name));
    await this._dataSource.transaction(async (manager) => {
      await this._methodsCrud.updateMany(
        toDeactivate.map((method) => method.id),
        { isActive: false },
        manager,
      );
      await this._methodsCrud.createMany(
        toCreate.map((name) => ({ method: name, isActive: true })),
        manager,
      );
    });
    return {
      created: toCreate,
      deactivated: toDeactivate.map((method) => method.method),
    };
  }
}
