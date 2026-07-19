import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  RmqCodeSendPublisher,
  TotpVerifier,
  TwoFaRequirementService,
  VerificationService,
  VerifierRegistry,
} from './services';

@Module({
  imports: [DatabaseModule, CryptoModule, MethodsModule],
  providers: [
    // порт отправки: мок (дефолт, e2e читают коды из него) или живой
    // RMQ-транспорт — выбор конфигом sendEvent.transport (SEND_TRANSPORT)
    MockCodeSendPublisher,
    RmqCodeSendPublisher,
    {
      provide: CODE_SEND_PUBLISHER,
      inject: [ConfigService, MockCodeSendPublisher, RmqCodeSendPublisher],
      useFactory: (
        config: ConfigService,
        mock: MockCodeSendPublisher,
        rmq: RmqCodeSendPublisher,
      ) => (config.get<string>('sendEvent.transport') === 'rmq' ? rmq : mock),
    },
    HashCodeVerifier,
    TotpVerifier,
    VerifierRegistry,
    CodeGeneratorService,
    IdentityNormalizerService,
    IdentityMaskerService,
    OperationService,
    VerificationService,
    TwoFaRequirementService,
    RetentionService,
  ],
  exports: [
    OperationService,
    VerificationService,
    TwoFaRequirementService,
    IdentityNormalizerService,
    MockCodeSendPublisher,
  ],
})
export class OperationsModule {}
