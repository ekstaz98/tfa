import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Единая точка правды для дефолтов 2ФА, настраиваемых через env — чтобы оба
 * значения читались из одного места, а не расползались по сервисам.
 *
 * userMethodsActive (USER_METHODS_ACTIVE): активен ли метод с тегом user,
 * пока юзер не создал переопределение (user_methods отсутствует). Один флаг
 * на ВСЕ user-методы, не per-method — читают отсюда
 * EffectiveMethodsResolverService (resolve/resolveMethodTypes — что реально
 * гейтит 2ФА) и UserSettingsService (listMyMethods — экран настроек), чтобы
 * «что требуем» и «что показываем» не расходились.
 *   true  (по умолчанию) — opt-out: метод включён конфигурацией админа,
 *         юзер отключает сам (updateMyTwoFaMethod isActive: false);
 *   false — opt-in: метод выключен, пока юзер сам его не включит.
 *
 * defaultMethodsActive (DEFAULT_METHODS_ACTIVE):
 * начальное значение users.default_methods_enabled (общий переключатель
 * default-методов) для юзера, которого только что создал user.sync
 * (UsersSyncService._upsertUser). Действует только в момент create — на уже
 * существующих юзеров не влияет, они меняют переключатель сами через
 * updateMyTwoFaDefaults.
 *   true  (по умолчанию) — юзер стартует с включённым переключателем;
 *   false — юзер стартует выключенным, включает сам.
 */
@Injectable()
export class UserMethodPolicyService {
  private readonly _defaultActive: boolean;
  private readonly _defaultMethodsEnabledOnCreate: boolean;

  constructor(config: ConfigService) {
    this._defaultActive = config.getOrThrow<boolean>(
      'methods.userDefaultActive',
    );
    this._defaultMethodsEnabledOnCreate = config.getOrThrow<boolean>(
      'methods.defaultMethodsActive',
    );
  }

  /** true — user-метод без user_methods считается включённым (opt-out). */
  get userMethodsActive(): boolean {
    return this._defaultActive;
  }

  /** Значение users.default_methods_enabled для только что созданного юзера. */
  get defaultMethodsActive(): boolean {
    return this._defaultMethodsEnabledOnCreate;
  }
}
