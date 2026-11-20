import { Module } from '@nestjs/common';

import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { JwtModule } from 'src/engine/core-modules/jwt/jwt.module';
import { WorkspaceManyOrAllFlatEntityMapsCacheModule } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.module';
import { MiddlewareService } from 'src/engine/middlewares/middleware.service';
import { AdminPortalEmbedMiddleware } from 'src/engine/middlewares/admin-portal-embed.middleware';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';

@Module({
  imports: [
    WorkspaceCacheStorageModule,
    WorkspaceManyOrAllFlatEntityMapsCacheModule,
    TokenModule,
    JwtModule,
  ],
  providers: [MiddlewareService, AdminPortalEmbedMiddleware],
  exports: [MiddlewareService, AdminPortalEmbedMiddleware],
})
export class MiddlewareModule {}
