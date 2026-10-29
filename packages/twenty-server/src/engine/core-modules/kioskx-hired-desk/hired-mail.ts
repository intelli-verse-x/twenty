import { createTransport } from 'nodemailer';

export const HIRED_MAIL = Symbol('HIRED_MAIL');
export interface HiredMail {
  configured(): boolean;
  send(input: {
    destination: string;
    body: string;
    operationId: string;
  }): Promise<void>;
}

// Use the workspace's explicitly approved sender and existing SMTP settings.
// The generic email queue retries ambiguous deliveries and its SMTP driver does
// not await acceptance. Neither behavior is safe for this one-click desk action.
export class HiredWorkspaceMail implements HiredMail {
  configured() {
    return (
      process.env.KIOSKX_HIRED_EMAIL === 'true' &&
      !!process.env.EMAIL_SMTP_HOST &&
      /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(
        process.env.KIOSKX_HIRED_EMAIL_FROM ?? '',
      )
    );
  }

  async send(input: {
    destination: string;
    body: string;
    operationId: string;
  }) {
    if (!this.configured()) throw new Error('Email unavailable');
    const port = Number(process.env.EMAIL_SMTP_PORT || 587);
    const transport = createTransport({
      host: process.env.EMAIL_SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: true,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      ...(process.env.EMAIL_SMTP_USER
        ? {
            auth: {
              user: process.env.EMAIL_SMTP_USER,
              pass: process.env.EMAIL_SMTP_PASSWORD,
            },
          }
        : {}),
    });
    try {
      const result = await transport.sendMail({
        from: process.env.KIOSKX_HIRED_EMAIL_FROM,
        to: input.destination,
        subject: 'Your KioskX inquiry',
        text: input.body,
        messageId: `<${input.operationId}@kiosk-x.ai>`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (!result.accepted?.length || result.rejected?.length)
        throw new Error('Email not accepted');
    } finally {
      transport.close();
    }
  }
}
