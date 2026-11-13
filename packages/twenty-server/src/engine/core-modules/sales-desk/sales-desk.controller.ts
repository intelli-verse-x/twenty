import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { ExtractJwt } from 'passport-jwt';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { isHiredDesk } from '../kioskx-hired-desk/hired-policy';
import {
  SALES_QUEUES,
  SalesDeskService,
  type SalesQueue,
} from './sales-desk.service';

@Controller('sales-desk')
export class SalesDeskController {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly desk: SalesDeskService,
  ) {}
  private async authorize(
    request: Request,
    response: Response,
    session = false,
  ) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
    if (!token) {
      response.status(401).end();
      return;
    }
    let identity;
    try {
      identity = await this.tokens.validateToken(token);
    } catch {
      response.status(401).end();
      return;
    }
    if (isHiredDesk(identity)) {
      response.status(403).end();
      return;
    }
    const email = identity.user?.email;
    if (!email || !identity.workspace?.id) {
      response.status(403).end();
      return;
    }
    const allowed = this.desk.allowed(email);
    if (!allowed && !session) {
      response.status(403).end();
      return;
    }
    return { workspace: identity.workspace.id, allowed };
  }
  private queue(value: string): SalesQueue {
    if (!SALES_QUEUES.includes(value as SalesQueue))
      throw new BadRequestException('Unknown queue.');
    return value as SalesQueue;
  }
  private input(body: unknown) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      JSON.stringify(body).length > 12000
    )
      throw new BadRequestException('Invalid request.');
    return body as Record<string, unknown>;
  }
  @Get('session')
  @Header('Cache-Control', 'no-store')
  async session(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const identity = await this.authorize(request, response, true);
    if (!identity) return;
    return {
      allowed: identity.allowed,
      ...(identity.allowed ? { channels: this.desk.channels() } : {}),
    };
  }
  @Get('queues/:queue')
  @Header('Cache-Control', 'no-store')
  async read(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('queue') queue: string,
  ) {
    const identity = await this.authorize(request, response);
    if (!identity) return;
    const name = this.queue(queue);
    try {
      return await this.desk.read(identity.workspace, name);
    } catch {
      response.status(503);
      return { unavailable: true };
    }
  }
  @Post('queues/:queue/:id/save')
  @Header('Cache-Control', 'no-store')
  async save(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('queue') queue: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const identity = await this.authorize(request, response);
    if (!identity) return;
    return this.desk.save(
      identity.workspace,
      this.queue(queue),
      id,
      this.input(body),
    );
  }
  @Post('queues/:queue/:id/email')
  @Header('Cache-Control', 'no-store')
  async email(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('queue') queue: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const identity = await this.authorize(request, response);
    if (!identity) return;
    const input = this.input(body);
    if (
      Object.keys(input).sort().join(',') !== 'body,requestId' ||
      typeof input.requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(input.requestId) ||
      typeof input.body !== 'string' ||
      !input.body.trim() ||
      input.body.length > 10000
    )
      throw new BadRequestException('Invalid message.');
    return this.desk.email(
      identity.workspace,
      this.queue(queue),
      id,
      input.requestId,
      input.body,
    );
  }
  @Post('queues/:queue/:id/call')
  @Header('Cache-Control', 'no-store')
  async call(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('queue') queue: string,
  ) {
    const identity = await this.authorize(request, response);
    if (!identity) return;
    if (this.queue(queue) === 'turo')
      throw new BadRequestException('The fleet report has no calling.');
    return this.desk.call();
  }
}
