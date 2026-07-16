import { Injectable } from '@nestjs/common';
import { TOTP_TYPE } from '../../methods/constants';
import { CodeVerifierPort } from './code-verifier.port';
import { HashCodeVerifier } from './hash-code.verifier';
import { TotpVerifier } from './totp.verifier';

/**
 * Реестр typeName -> verifier (OCP): новый тип 2ФА со своей верификацией =
 * register() без изменения домена; типы без записи используют
 * HashCodeVerifier по умолчанию.
 */
@Injectable()
export class VerifierRegistry {
  private readonly verifiers = new Map<string, CodeVerifierPort>();
  private readonly selfVerified = new Set<string>();

  constructor(
    private readonly defaultVerifier: HashCodeVerifier,
    totpVerifier: TotpVerifier,
  ) {
    this.register(TOTP_TYPE, totpVerifier, { selfVerified: true });
  }

  register(
    typeName: string,
    verifier: CodeVerifierPort,
    options: { selfVerified?: boolean } = {},
  ): void {
    this.verifiers.set(typeName, verifier);
    if (options.selfVerified) {
      this.selfVerified.add(typeName);
    }
  }

  get(typeName: string): CodeVerifierPort {
    return this.verifiers.get(typeName) ?? this.defaultVerifier;
  }

  /** Тип верифицируется без отправки (GA): нет code_hash, retry и событий. */
  isSelfVerified(typeName: string): boolean {
    return this.selfVerified.has(typeName);
  }
}
