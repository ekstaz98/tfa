// import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  EffectiveMethodsResolverService,
  MethodsAdminService,
  MethodsSyncService,
  SettingsHashService,
  UserSettingsService,
} from '../../methods/services';
import {
  CreateMethodsInput,
  TwoFaMethodDto,
  TwoFaMethodsInput,
  TwoFaMethodsResponse,
  UpdateListMethodsResponse,
  UpdateMethodsInput,
  UpdateMyMethodsInput,
} from '../dto';
// import { AdminGuard, AuthedGuard, ServiceGuard } from '../guards/role.guards';
import { ReqCtx, dropNulls } from '../helpers';
import { RequestContext } from '../interfaces';

@Resolver(() => TwoFaMethodDto)
export class MethodsResolver {
  constructor(
    private readonly _effectiveMethods: EffectiveMethodsResolverService,
    private readonly _settingsHash: SettingsHashService,
    private readonly _adminService: MethodsAdminService,
    private readonly _syncService: MethodsSyncService,
    private readonly _userSettings: UserSettingsService,
  ) {}

  @Query(() => TwoFaMethodsResponse, { name: 'twoFaMethods' })
  async twoFaMethods(
    @ReqCtx() ctx: RequestContext,
    @Args('input', { nullable: true }) input?: TwoFaMethodsInput,
  ): Promise<TwoFaMethodsResponse> {
    const methods = await this._effectiveMethods.resolve(
      ctx.userId,
      input?.tags ?? [],
    );
    const hash = this._settingsHash.compute(methods);
    if (input?.hash && input.hash === hash) {
      return { hash, upToDate: true, methods: null };
    }
    return { hash, upToDate: false, methods };
  }

  // @UseGuards(AdminGuard)
  @Mutation(() => [TwoFaMethodDto])
  createTwoFaMethod(
    @Args('input') input: CreateMethodsInput,
  ): Promise<TwoFaMethodDto[]> {
    return this._adminService.createMethods(input.methods.map(dropNulls));
  }

  // @UseGuards(AdminGuard)
  @Mutation(() => [TwoFaMethodDto])
  updateTwoFaMethod(
    @Args('input') input: UpdateMethodsInput,
  ): Promise<TwoFaMethodDto[]> {
    return this._adminService.updateMethods(input.methods.map(dropNulls));
  }

  // @UseGuards(AuthedGuard)
  @Mutation(() => [TwoFaMethodDto])
  updateMyTwoFaMethod(
    @ReqCtx() ctx: RequestContext,
    @Args('input') input: UpdateMyMethodsInput,
  ): Promise<TwoFaMethodDto[]> {
    return this._userSettings.updateMyMethods(
      ctx.userId as string,
      input.methods.map(dropNulls),
    );
  }

  /** Автосинк методов из схемы гейтвея (service-роль). */
  // @UseGuards(ServiceGuard)
  @Mutation(() => UpdateListMethodsResponse)
  updateTwoFaListMethods(): Promise<UpdateListMethodsResponse> {
    return this._syncService.updateListMethods();
  }
}
