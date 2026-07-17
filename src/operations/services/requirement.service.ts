import { Injectable } from '@nestjs/common';
import {
  MethodsCrudService,
  UserCredentialsCrudService,
  UsersCrudService,
} from '../../database/crud';
import {
  EffectiveActor,
  EffectiveMethodsResolverService,
} from '../../methods/services';
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

    let actor: EffectiveActor = params.userId ?? null;
    if (!actor && params.identity) {
      const normalized = this._normalizer.normalize(params.identity);
      const credentials = await this._credentialsCrud.findBy({
        identity: normalized,
        isDeleted: false,
      });
      const confirmed = credentials.find(
        (credential) => credential.isConfirmed && credential.isActive,
      );
      if (confirmed) {
        actor = await this._usersCrud.findById(confirmed.userId);
      }
    }

    const effectiveTypes = await this._effectiveMethods.resolveMethodTypes(
      method,
      null,
      actor,
    );
    return effectiveTypes.length > 0;
  }
}
