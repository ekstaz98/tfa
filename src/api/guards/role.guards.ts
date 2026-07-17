import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ROLE_ADMIN, ROLE_SERVICE } from '../interfaces';
import { requestContextOf } from '../helpers';

/**
 * Guard-заглушки: сервис доверяет заголовкам гейтвея (x-roles, x-user-id),
 * реальная авторизация — на гейтвее, вне скоупа скелета.
 */
abstract class RoleGuard implements CanActivate {
  protected abstract readonly _role: string;

  canActivate(context: ExecutionContext): boolean {
    if (!requestContextOf(context).roles.includes(this._role)) {
      throw new ForbiddenException(`Role "${this._role}" is required`);
    }
    return true;
  }
}

@Injectable()
export class AdminGuard extends RoleGuard {
  protected readonly _role = ROLE_ADMIN;
}

@Injectable()
export class ServiceGuard extends RoleGuard {
  protected readonly _role = ROLE_SERVICE;
}

/** Для ручек юзера (updateMyTwoFaMethod): требуется x-user-id. */
@Injectable()
export class AuthedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!requestContextOf(context).userId) {
      throw new UnauthorizedException('Authenticated user is required');
    }
    return true;
  }
}
