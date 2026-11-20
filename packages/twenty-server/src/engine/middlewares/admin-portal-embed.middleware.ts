import { Injectable, type NestMiddleware } from '@nestjs/common';

import { type NextFunction, type Request, type Response } from 'express';

const DEFAULT_FRAME_ANCESTORS = [
  "'self'",
  'https://admin.intelli-verse-x.ai',
  'http://localhost:3000',
  'http://localhost:3001',
];

const applyAdminPortalEmbedHeaders = (res: Response) => {
  const contentType = res.getHeader('Content-Type')?.toString() ?? '';

  if (!contentType.startsWith('text/html')) {
    return;
  }

  res.removeHeader('X-Frame-Options');

  const existingCsp = res.getHeader('Content-Security-Policy')?.toString() ?? '';

  if (existingCsp.includes('frame-ancestors')) {
    return;
  }

  const ancestors =
    process.env.ADMIN_PORTAL_FRAME_ANCESTORS?.trim() ||
    DEFAULT_FRAME_ANCESTORS.join(' ');

  res.setHeader(
    'Content-Security-Policy',
    existingCsp
      ? `${existingCsp}; frame-ancestors ${ancestors}`
      : `frame-ancestors ${ancestors}`,
  );
};

/** Allow IntelliVerse admin hub to embed Twenty CRM in an iframe. */
@Injectable()
export class AdminPortalEmbedMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction) {
    const originalEnd = res.end.bind(res);

    res.end = ((...args: Parameters<Response['end']>) => {
      applyAdminPortalEmbedHeaders(res);

      return originalEnd(...args);
    }) as Response['end'];

    next();
  }
}
