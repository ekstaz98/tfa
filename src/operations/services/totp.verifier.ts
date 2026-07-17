import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { UserCredentialsCrudService } from '../../database/crud';
import { CredentialCipherService } from '../../crypto/credential-cipher.service';
import { base32Decode, currentTimeStep, totpCode } from '../helpers/totp';
import { CodeVerifierPort, CodeVerifyContext } from '../interfaces';

/**
 * Верификатор GA/TOTP: по расшифрованному user_credentials.secret,
 * окно ±1 time-step. Anti-replay: успешный time-step сохраняется в
 * last_used_counter, повтор того же слота отклоняется.
 */
@Injectable()
export class TotpVerifier implements CodeVerifierPort {
  constructor(
    private readonly _credentialsCrud: UserCredentialsCrudService,
    private readonly _cipher: CredentialCipherService,
  ) {}

  async verify(context: CodeVerifyContext): Promise<boolean> {
    if (!context.operation.userId) {
      return false;
    }
    const [credential] = await this._credentialsCrud.findBy(
      {
        userId: context.operation.userId,
        typeId: context.codeRow.typeId,
        isConfirmed: true,
        isActive: true,
        isDeleted: false,
      },
      context.manager,
    );
    if (!credential?.secret) {
      return false;
    }

    const secret = base32Decode(this._cipher.decrypt(credential.secret));
    const lastUsed =
      credential.lastUsedCounter === null
        ? null
        : Number(credential.lastUsedCounter);
    const now = currentTimeStep();
    for (const step of [now - 1, now, now + 1]) {
      if (lastUsed !== null && step <= lastUsed) {
        continue; // anti-replay: слот уже использован
      }
      const expected = Buffer.from(totpCode(secret, step));
      const provided = Buffer.from(context.code);
      if (
        expected.length === provided.length &&
        timingSafeEqual(expected, provided)
      ) {
        await this._credentialsCrud.update(
          credential.id,
          { lastUsedCounter: String(step) },
          context.manager,
        );
        return true;
      }
    }
    return false;
  }
}
