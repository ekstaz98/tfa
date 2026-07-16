import { Injectable } from '@nestjs/common';
import { CodeGeneratorService } from '../code-generator.service';
import { CodeVerifierPort, CodeVerifyContext } from './code-verifier.port';

/** Верификатор по хэшу (sms/email/…): HMAC-SHA256 + timingSafeEqual. */
@Injectable()
export class HashCodeVerifier implements CodeVerifierPort {
  constructor(private readonly codeGenerator: CodeGeneratorService) {}

  verify(context: CodeVerifyContext): Promise<boolean> {
    return Promise.resolve(
      this.codeGenerator.matches(context.code, context.codeRow.codeHash),
    );
  }
}
