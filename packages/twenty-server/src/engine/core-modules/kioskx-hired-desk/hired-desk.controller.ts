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
import { ExtractJwt } from 'passport-jwt';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { HIRED_WORKSPACE, isHiredDesk } from './hired-policy';
import { HiredDeskService } from './hired-desk.service';

@Controller('kioskx-hired-desk')
export class HiredDeskController {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly desk: HiredDeskService,
  ) {}
  private async authorize(request: Request) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
    if (!token) throw new ForbiddenException();
    const identity = await this.tokens.validateToken(token);
    if (!isHiredDesk(identity)) throw new ForbiddenException();
  }
  @Get('session')
  @Header('Cache-Control', 'no-store')
  async session(@Req() request: Request) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);

    if (!token) return { hired: false };

    // Identity discovery must not depend on the hired endpoint allowlist.
    return { hired: isHiredDesk(await this.tokens.validateToken(token)) };
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
  @Get('voice-config')
  @Header('Cache-Control', 'no-store')
  async voiceConfig(@Req() request: Request) {
    await this.authorize(request);
    return this.desk.bridgeConfig();
  }
  @Post('voice-bridge')
  @Header('Cache-Control', 'no-store')
  async voiceBridge(@Req() request: Request, @Body() body: unknown) {
    await this.authorize(request);
    if (!body || typeof body !== 'object' || JSON.stringify(body).length > 5000)
      throw new ForbiddenException();
    return this.desk.bridge(body as Record<string, unknown>);
  }
  @Post('voice-transcript')
  @Header('Cache-Control', 'no-store')
  async voiceTranscript(@Req() request: Request, @Body() body: unknown) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
    if (!token) throw new ForbiddenException();
    const identity = await this.tokens.validateToken(token);
    const admins = (process.env.KIOSKX_VOICE_TRANSCRIPT_ADMIN_IDS || '').split(',');
    if (isHiredDesk(identity) || identity.workspace?.id !== HIRED_WORKSPACE ||
        !identity.user?.id || !admins.includes(identity.user.id)) throw new ForbiddenException();
    const input = body as Record<string, unknown>;
    if (!input || typeof input.operationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.operationId) ||
        typeof input.transcript !== 'string' || !input.transcript.trim() || input.transcript.length > 100000 ||
        typeof input.source !== 'string' || !/^https:\/\/(?:voice.google.com|drive.google.com)\/[^\s]{1,500}$/.test(input.source))
      throw new ForbiddenException();
    return this.desk.importVoiceTranscript(input.operationId, input.transcript.trim(), input.source);
  }
  @Post('email')
  @Header('Cache-Control', 'no-store')
  async email(@Req() request: Request, @Body() body: unknown) {
    await this.authorize(request);
    if (!body || typeof body !== 'object') throw new ForbiddenException();
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).sort().join(',') !== 'body,leadId,requestId' ||
      typeof input.leadId !== 'string' ||
      typeof input.requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(input.leadId) ||
      !/^[0-9a-f-]{36}$/i.test(input.requestId) ||
      typeof input.body !== 'string' ||
      !input.body.trim() ||
      input.body.length > 10000
    )
      throw new ForbiddenException();
    return this.desk.email(input.leadId, input.requestId, input.body);
  }
}
