import { HiredWorkspaceMail } from './hired-mail';
import { createTransport } from 'nodemailer';
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  jest.clearAllMocks();
});
const configure = () => {
  process.env.KIOSKX_HIRED_EMAIL = 'true';
  process.env.KIOSKX_HIRED_EMAIL_FROM = 'workspace@example.test';
  process.env.EMAIL_SMTP_HOST = 'smtp.example.test';
};
it('defaults off, including with SMTP but no workspace sender', () => {
  delete process.env.KIOSKX_HIRED_EMAIL;
  expect(new HiredWorkspaceMail().configured()).toBe(false);
  configure();
  delete process.env.KIOSKX_HIRED_EMAIL_FROM;
  expect(new HiredWorkspaceMail().configured()).toBe(false);
});
it('awaits SMTP acceptance and uses only the workspace sender and one recipient', async () => {
  configure();
  const sendMail = jest.fn(async (_options: unknown) => ({
    accepted: ['lead@example.test'],
    rejected: [],
  }));
  const close = jest.fn();
  (createTransport as jest.Mock).mockReturnValue({ sendMail, close });
  await new HiredWorkspaceMail().send({
    destination: 'lead@example.test',
    body: 'Hello',
    operationId: 'operation',
  });
  expect(sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      from: 'workspace@example.test',
      to: 'lead@example.test',
      text: 'Hello',
      disableFileAccess: true,
      disableUrlAccess: true,
    }),
  );
  expect(sendMail.mock.calls[0][0]).not.toHaveProperty('cc');
  expect(close).toHaveBeenCalled();
});
it('propagates ambiguous failures without retrying or logging the recipient', async () => {
  configure();
  const sendMail = jest.fn(async () => {
    throw new Error('fixture transport error');
  });
  const close = jest.fn();
  (createTransport as jest.Mock).mockReturnValue({ sendMail, close });
  await expect(
    new HiredWorkspaceMail().send({
      destination: 'lead@example.test',
      body: 'Hello',
      operationId: 'operation',
    }),
  ).rejects.toThrow();
  expect(sendMail).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalled();
});
