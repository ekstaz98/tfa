import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  Code,
  Method,
  MethodTag,
  MethodType,
  Operation,
  Tag,
  Type,
  User,
  UserCredential,
  UserMethod,
  UserMethodType,
} from '../../database/entities';
import { CredentialCipherService } from '../../crypto/credential-cipher.service';
import { EffectiveMethodsResolverService } from '../../methods/services';
import {
  FakeCodesCrud,
  FakeCrud,
  FakeDataSource,
  FakeOperationsCrud,
  fakeConfig,
  fakeDataSource,
  seedDictionaries,
} from '../../testing/fakes';
import { CodeGeneratorService } from '../code-generator.service';
import {
  IdentityMaskerService,
  IdentityNormalizerService,
} from '../identity.service';
import {
  CodeSendEvent,
  CodeSendPublisherPort,
} from '../ports/code-send-publisher.port';
import { HashCodeVerifier } from '../ports/hash-code.verifier';
import { TotpVerifier } from '../ports/totp.verifier';
import { VerifierRegistry } from '../ports/verifier-registry';

/** Publisher, запоминающий, была ли открыта транзакция в момент publish. */
export class CapturingPublisher implements CodeSendPublisherPort {
  events: CodeSendEvent[] = [];
  publishedInTransaction: boolean[] = [];
  failWith: Error | null = null;

  constructor(private readonly ds: FakeDataSource) {}

  publish(event: CodeSendEvent): Promise<void> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    this.events.push(event);
    this.publishedInTransaction.push(this.ds.inTransaction);
    return Promise.resolve();
  }
}

export interface OperationsTestBed {
  config: ConfigService;
  ds: FakeDataSource;
  publisher: CapturingPublisher;
  cipher: CredentialCipherService;
  codeGenerator: CodeGeneratorService;
  verifierRegistry: VerifierRegistry;
  effectiveMethods: EffectiveMethodsResolverService;
  masker: IdentityMaskerService;
  normalizer: IdentityNormalizerService;
  crud: {
    methods: FakeCrud<Method>;
    methodTypes: FakeCrud<MethodType>;
    methodTags: FakeCrud<MethodTag>;
    tags: FakeCrud<Tag>;
    types: FakeCrud<Type>;
    users: FakeCrud<User>;
    credentials: FakeCrud<UserCredential>;
    userMethods: FakeCrud<UserMethod>;
    userMethodTypes: FakeCrud<UserMethodType>;
    operations: FakeOperationsCrud<Operation>;
    codes: FakeCodesCrud<Code>;
  };
  addMethod(name: string, typeNames: string[], tagNames: string[]): Method;
  addUser(coreUserId: string): User;
  addCredential(
    user: User,
    typeName: string,
    identity: string,
    extra?: Partial<UserCredential>,
  ): UserCredential;
}

export const TEST_CONFIG_VALUES: Record<string, unknown> = {
  'codes.hmacSecret': 'test-hmac-secret-with-enough-length',
  'codes.length': 6,
  'codes.ttlSeconds': 300,
  'codes.retrySeconds': 120,
  'codes.attemptsLimit': 2,
  'codes.resendsLimit': 2,
  'limits.operationsPerDay': 2,
  'limits.unauthedOpsPerHourPerIp': 2,
  'retention.days': 30,
  'sendEvent.name': 'TFA_OTP',
  'sendEvent.providerByType': { email: 'smtp', sms: 'sms' },
  'totpCipher.currentVersion': '1',
  'totpCipher.keys': { '1': randomBytes(32).toString('hex') },
};

export function buildTestBed(): OperationsTestBed {
  const config = fakeConfig(TEST_CONFIG_VALUES);
  const ds = fakeDataSource();
  const publisher = new CapturingPublisher(ds);

  const crud = {
    methods: new FakeCrud<Method>({
      isActive: true,
      isDeleted: false,
    } as Partial<Method>),
    methodTypes: new FakeCrud<MethodType>(),
    methodTags: new FakeCrud<MethodTag>(),
    tags: new FakeCrud<Tag>(),
    types: new FakeCrud<Type>(),
    users: new FakeCrud<User>(),
    credentials: new FakeCrud<UserCredential>(),
    userMethods: new FakeCrud<UserMethod>({
      isActive: true,
      isDeleted: false,
    } as Partial<UserMethod>),
    userMethodTypes: new FakeCrud<UserMethodType>(),
    operations: new FakeOperationsCrud<Operation>(),
    codes: new FakeCodesCrud<Code>({
      attempts: 0,
      sendsCount: 1,
    } as Partial<Code>),
  };
  seedDictionaries(crud.tags, crud.types);

  const cipher = new CredentialCipherService(config);
  const codeGenerator = new CodeGeneratorService(config);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const verifierRegistry = new VerifierRegistry(
    new HashCodeVerifier(codeGenerator),
    new TotpVerifier(crud.credentials as any, cipher),
  );
  const effectiveMethods = new EffectiveMethodsResolverService(
    crud.users as any,
    crud.methods as any,
    crud.methodTypes as any,
    crud.methodTags as any,
    crud.userMethods as any,
    crud.userMethodTypes as any,
    crud.types as any,
    crud.tags as any,
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    config,
    ds,
    publisher,
    cipher,
    codeGenerator,
    verifierRegistry,
    effectiveMethods,
    masker: new IdentityMaskerService(),
    normalizer: new IdentityNormalizerService(),
    crud,
    addMethod(name, typeNames, tagNames) {
      const method = crud.methods.seed({ method: name } as Partial<Method>);
      for (const type of typeNames) {
        crud.methodTypes.seed({ methodId: method.id, typeId: `type-${type}` });
      }
      for (const tag of tagNames) {
        crud.methodTags.seed({ methodId: method.id, tagId: `tag-${tag}` });
      }
      return method;
    },
    addUser(coreUserId) {
      return crud.users.seed({ userId: coreUserId } as Partial<User>);
    },
    addCredential(user, typeName, identity, extra = {}) {
      return crud.credentials.seed({
        userId: user.id,
        typeId: `type-${typeName}`,
        identity,
        secret: null,
        isConfirmed: true,
        isActive: true,
        isDeleted: false,
        lastUsedCounter: null,
        ...extra,
      } as Partial<UserCredential>);
    },
  };
}
