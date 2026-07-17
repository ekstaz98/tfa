// import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import {
  OperationService,
  TwoFaRequirementService,
  VerificationService,
} from '../../operations/services';
import {
  SendTwoFaInput,
  SendTwoFaResponse,
  VerifyTwoFaInput,
  VerifyTwoFaResponse,
} from '../dtos';
// import { ServiceGuard } from '../guards/role.guards';
import { ReqCtx } from '../helpers';
import { RequestContext } from '../interfaces';

function badRequest(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: 'BAD_USER_INPUT' },
  });
}

@Resolver()
export class OperationsResolver {
  constructor(
    private readonly _operationService: OperationService,
    private readonly _verificationService: VerificationService,
    private readonly _requirementService: TwoFaRequirementService,
  ) {}

  @Mutation(() => SendTwoFaResponse)
  sendTwoFa(
    @ReqCtx() ctx: RequestContext,
    @Args('input') input: SendTwoFaInput,
  ): Promise<SendTwoFaResponse> {
    // согласованное расширение ТЗ: identity обязателен без авторизации,
    // запрещён при ней; types — только вместе с x-2fa-operationId
    if (ctx.userId && input.identity) {
      throw badRequest('identity is not allowed for authenticated requests');
    }
    if (!ctx.userId && !input.identity) {
      throw badRequest('identity is required for unauthenticated requests');
    }
    if (input.types?.length && !ctx.operationId) {
      throw badRequest(
        'types subset is allowed only for resend (x-2fa-operationId header)',
      );
    }
    return this._operationService.sendTwoFa({
      method: input.method,
      actor: {
        userId: ctx.userId,
        identity: input.identity ?? null,
        clientIp: ctx.clientIp,
      },
      types: input.types,
      locale: input.locale ?? undefined,
      operationId: ctx.operationId ?? undefined,
    });
  }

  /**
   * Гейтвей (service-роль): с operationId — верификация кодов перед
   * проксированием; без — «покрыт ли метод» для (method, userId | identity).
   */
  // @UseGuards(ServiceGuard)
  @Mutation(() => VerifyTwoFaResponse)
  async verifyTwoFa(
    @Args('input') input: VerifyTwoFaInput,
  ): Promise<VerifyTwoFaResponse> {
    if (!input.operationId) {
      const required = await this._requirementService.isRequired({
        method: input.method,
        userId: input.userId ?? null,
        identity: input.identity ?? null,
      });
      return { required, verified: null, userId: null, identity: null };
    }
    const result = await this._verificationService.verify({
      operationId: input.operationId,
      method: input.method,
      userId: input.userId ?? null,
      codes: input.codes ?? [],
    });
    return { ...result, required: null };
  }
}
