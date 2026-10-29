import { Module } from '@nestjs/common';
import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { HiredDeskController } from './hired-desk.controller';
import { HIRED_MAIL, HiredWorkspaceMail } from './hired-mail';
import { HiredDeskService } from './hired-desk.service';

@Module({
  imports: [TokenModule],
  controllers: [HiredDeskController],
  providers: [
    HiredDeskService,
    { provide: HIRED_MAIL, useClass: HiredWorkspaceMail },
  ],
})
export class HiredDeskModule {}
