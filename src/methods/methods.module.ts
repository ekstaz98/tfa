import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EffectiveMethodsResolverService } from './effective-methods-resolver.service';
import { GatewayIntrospectionService } from './gateway-introspection.service';
import { GATEWAY_METHODS_PORT } from './gateway-methods.port';
import { MethodViewsService } from './method-views.service';
import { MethodsAdminService } from './methods-admin.service';
import { MethodsSyncService } from './methods-sync.service';
import { SettingsHashService } from './settings-hash.service';
import { UserSettingsService } from './user-settings.service';

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
  ],
  exports: [
    MethodsAdminService,
    MethodsSyncService,
    UserSettingsService,
    EffectiveMethodsResolverService,
    SettingsHashService,
  ],
})
export class MethodsModule {}
