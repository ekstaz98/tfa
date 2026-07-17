import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { DatabaseModule } from '../database/database.module';
import { MethodsModule } from '../methods/methods.module';
import { CODE_SEND_PUBLISHER } from './interfaces';
import {
  CodeGeneratorService,
  HashCodeVerifier,
  IdentityMaskerService,
  IdentityNormalizerService,
  MockCodeSendPublisher,
  OperationService,
  RetentionService,
  TotpVerifier,
  VerificationService,
  VerifierRegistry,
} from './services';

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
