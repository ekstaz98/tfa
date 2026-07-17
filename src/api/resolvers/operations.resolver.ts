import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import {
  OperationService,
  TwoFaRequirementService,
  VerificationService,
} from '../../operations/services';
import {
  Send2FaInput,
  Send2FaResponse,
  Verify2faInput,
  Verify2faResponse,
} from '../dto';
import { ServiceGuard } from '../guards/role.guards';
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

  @Mutation(() => Send2FaResponse)
  send2Fa(
    @ReqCtx() ctx: RequestContext,
    @Args('input') input: Send2FaInput,
  ): Promise<Send2FaResponse> {
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
    return this._operationService.send2Fa({
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
  @UseGuards(ServiceGuard)
  @Mutation(() => Verify2faResponse)
  async verify2fa(
    @Args('input') input: Verify2faInput,
  ): Promise<Verify2faResponse> {
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
