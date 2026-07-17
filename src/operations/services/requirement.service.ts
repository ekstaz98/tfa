import { Injectable } from '@nestjs/common';
import {
  MethodsCrudService,
  UserCredentialsCrudService,
  UsersCrudService,
} from '../../database/crud';
import { EffectiveMethodsResolverService } from '../../methods/services';
import { RequirementParams } from '../interfaces';
import { IdentityNormalizerService } from './identity.service';

/**
 * verifyTwoFa без operationId: покрыт ли метод 2ФА для (userId | identity).
 * Для unauthed-методов identity резолвится в юзера — ответ по его настройкам,
 * поэтому юзер может полностью отключить 2ФА на signin. Неизвестный identity →
 * ответ по конфигурации метода; неизвестный/неактивный метод → false
 * (консистентно с автосинком: не настроен = не покрыт).
 */
@Injectable()
export class TwoFaRequirementService {
  constructor(
    private readonly _methodsCrud: MethodsCrudService,
    private readonly _usersCrud: UsersCrudService,
    private readonly _credentialsCrud: UserCredentialsCrudService,
    private readonly _normalizer: IdentityNormalizerService,
    private readonly _effectiveMethods: EffectiveMethodsResolverService,
  ) {}

  async isRequired(params: RequirementParams): Promise<boolean> {
    const [method] = await this._methodsCrud.findBy({
      method: params.method,
      isDeleted: false,
    });
    if (!method || !method.isActive) {
      return false;
    }

    let coreUserId: string | null = params.userId ?? null;
    if (!coreUserId && params.identity) {
      const normalized = this._normalizer.normalize(params.identity);
      const credentials = await this._credentialsCrud.findBy({
        identity: normalized,
        isDeleted: false,
      });
      const confirmed = credentials.find(
        (credential) => credential.isConfirmed && credential.isActive,
      );
      if (confirmed) {
        const user = await this._usersCrud.findById(confirmed.userId);
        coreUserId = user?.userId ?? null;
      }
    }

    const effective = await this._effectiveMethods.resolve(coreUserId);
    return effective.some((view) => view.id === method.id);
  }
}
