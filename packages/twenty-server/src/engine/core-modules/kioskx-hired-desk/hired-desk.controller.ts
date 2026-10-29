import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { type Request } from 'express';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { isHiredDesk } from './hired-policy';
import { HiredDeskService } from './hired-desk.service';

@Controller('kioskx-hired-desk')
export class HiredDeskController {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly desk: HiredDeskService,
  ) {}
  private async authorize(request: Request) {
    const identity = await this.tokens.validateTokenByRequest(request);
    if (!isHiredDesk(identity)) throw new ForbiddenException();
  }
  @Get('session')
  @Header('Cache-Control', 'no-store')
  async session(@Req() request: Request) {
    return {
      hired: isHiredDesk(await this.tokens.validateTokenByRequest(request)),
    };
  }
  @Get('leads')
  @Header('Cache-Control', 'no-store')
  async leads(@Req() request: Request) {
    await this.authorize(request);
    return this.desk.leads();
  }
  @Post('call')
  @Header('Cache-Control', 'no-store')
  async call(@Req() request: Request, @Body() body: unknown) {
    await this.authorize(request);
    if (!body || typeof body !== 'object') throw new ForbiddenException();
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).sort().join(',') !== 'leadId,requestId' ||
      typeof input.leadId !== 'string' ||
      typeof input.requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(input.leadId) ||
      !/^[0-9a-f-]{36}$/i.test(input.requestId)
    )
      throw new ForbiddenException();
    return this.desk.call(input.leadId, input.requestId);
  }
}
