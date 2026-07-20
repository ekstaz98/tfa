import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  EffectiveMethodsResolverService,
  MethodViewsService,
  GatewayIntrospectionService,
  MethodsAdminService,
  MethodsSyncService,
  SettingsHashService,
  UserMethodPolicyService,
  UserSettingsService,
} from './services';
import { GATEWAY_METHODS_PORT } from './interfaces';

@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: GATEWAY_METHODS_PORT, useClass: GatewayIntrospectionService },
    MethodViewsService,
    MethodsAdminService,
    MethodsSyncService,
    UserSettingsService,
    EffectiveMethodsResolverService,
    SettingsHashService,
    UserMethodPolicyService,
  ],
  exports: [
    MethodsAdminService,
    MethodsSyncService,
    UserSettingsService,
    EffectiveMethodsResolverService,
    SettingsHashService,
    UserMethodPolicyService,
  ],
})
export class MethodsModule {}
