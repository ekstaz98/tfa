import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { DatabaseModule } from '../database/database.module';
import { MethodsModule } from '../methods/methods.module';
import { CodeGeneratorService } from './code-generator.service';
import {
  IdentityMaskerService,
  IdentityNormalizerService,
} from './identity.service';
import { OperationService } from './operation.service';
import { CODE_SEND_PUBLISHER } from './ports/code-send-publisher.port';
import { HashCodeVerifier } from './ports/hash-code.verifier';
import { MockCodeSendPublisher } from './ports/mock-code-send-publisher';
import { TotpVerifier } from './ports/totp.verifier';
import { VerifierRegistry } from './ports/verifier-registry';
import { RetentionService } from './retention.service';
import { VerificationService } from './verification.service';

@Module({
  imports: [DatabaseModule, CryptoModule, MethodsModule],
  providers: [
    // мок — единственная реализация порта отправки в скелете; живой
    // адаптер к events-сервису = замена этого провайдера
    MockCodeSendPublisher,
    { provide: CODE_SEND_PUBLISHER, useExisting: MockCodeSendPublisher },
    HashCodeVerifier,
    TotpVerifier,
    VerifierRegistry,
    CodeGeneratorService,
    IdentityNormalizerService,
    IdentityMaskerService,
    OperationService,
    VerificationService,
    RetentionService,
  ],
  exports: [
    OperationService,
    VerificationService,
    IdentityNormalizerService,
    MockCodeSendPublisher,
  ],
})
export class OperationsModule {}
