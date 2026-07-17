import { Injectable } from '@nestjs/common';
import { CodeGeneratorService } from './code-generator.service';
import { CodeVerifierPort, CodeVerifyContext } from '../interfaces';

/** Верификатор по хэшу (sms/email/…): HMAC-SHA256 + timingSafeEqual. */
@Injectable()
export class HashCodeVerifier implements CodeVerifierPort {
  constructor(private readonly _codeGenerator: CodeGeneratorService) {}

  verify(context: CodeVerifyContext): Promise<boolean> {
    return Promise.resolve(
      this._codeGenerator.matches(context.code, context.codeRow.codeHash),
    );
  }
}
