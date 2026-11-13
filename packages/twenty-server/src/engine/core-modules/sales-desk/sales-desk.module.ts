import { Module } from '@nestjs/common';
import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { SalesDeskController } from './sales-desk.controller';
import { SalesDeskService } from './sales-desk.service';

@Module({
  imports: [TokenModule],
  controllers: [SalesDeskController],
  providers: [SalesDeskService],
})
export class SalesDeskModule {}
