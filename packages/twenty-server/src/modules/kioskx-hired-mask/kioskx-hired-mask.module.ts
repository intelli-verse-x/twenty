import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ToolModule } from 'src/engine/core-modules/tool/tool.module';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { MessagingSendManagerModule } from 'src/modules/messaging/message-outbound-manager/messaging-send-manager.module';
import { KioskxHiredMaskResolver } from './kioskx-hired-mask.resolver';
import { KioskxHiredMaskService } from './kioskx-hired-mask.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RoleTargetEntity, ConnectedAccountEntity]),
    ToolModule,
    MessagingSendManagerModule,
  ],
  providers: [KioskxHiredMaskResolver, KioskxHiredMaskService],
})
export class KioskxHiredMaskModule {}
