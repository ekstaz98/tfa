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
  MyTwoFaMethodDto,
  MyTwoFaMethodsInput,
  MyTwoFaSettingsDto,
  TwoFaMethodDto,
  TwoFaMethodsInput,
  TwoFaMethodsResponse,
  UpdateListMethodsResponse,
  UpdateMethodsInput,
  UpdateMyMethodsInput,
  UpdateMyTwoFaDefaultsInput,
} from '../dtos';
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

  /**
   * Экран настроек юзера: все user/default-методы, включая выключенные —
   * twoFaMethods их не показывает (контракт «что требует 2ФА сейчас»).
   */
  // @UseGuards(AuthedGuard)
  @Query(() => [MyTwoFaMethodDto], {
    name: 'myTwoFaMethods',
    description:
      'Все методы, настраиваемые юзером (теги user и default), включая ' +
      'выключенные. Для каждого — allowedTypes (набор админа), enabledTypes ' +
      '(действующие для юзера), isEnabled и managedBy (METHOD — ' +
      'updateMyTwoFaMethod, GLOBAL — updateMyTwoFaDefaults). ' +
      'input — опциональные фильтры выдачи. Требуется заголовок x-user-id.',
  })
  myTwoFaMethods(
    @ReqCtx() ctx: RequestContext,
    @Args('input', { nullable: true }) input?: MyTwoFaMethodsInput,
  ): Promise<MyTwoFaMethodDto[]> {
    return this._userSettings.listMyMethods(
      ctx.userId as string,
      input ? dropNulls(input) : {},
    );
  }

  // @UseGuards(AuthedGuard)
  @Query(() => MyTwoFaSettingsDto, {
    name: 'myTwoFaSettings',
    description:
      'Настройки 2ФА уровня аккаунта: общий переключатель default-методов. ' +
      'Требуется заголовок x-user-id.',
  })
  myTwoFaSettings(@ReqCtx() ctx: RequestContext): Promise<MyTwoFaSettingsDto> {
    return this._userSettings.getMySettings(ctx.userId as string);
  }

  /** Общий рубильник: вкл/выкл 2ФА на всех default-методах разом. */
  // @UseGuards(AuthedGuard)
  @Mutation(() => MyTwoFaSettingsDto, {
    description:
      'Включает/выключает 2ФА разом на всех методах режима default. ' +
      'На методы с тегами user (индивидуальные настройки) и system ' +
      '(обязательная 2ФА) не влияет. Требуется заголовок x-user-id.',
  })
  updateMyTwoFaDefaults(
    @ReqCtx() ctx: RequestContext,
    @Args('input') input: UpdateMyTwoFaDefaultsInput,
  ): Promise<MyTwoFaSettingsDto> {
    return this._userSettings.updateMyDefaults(
      ctx.userId as string,
      input.isEnabled,
    );
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
