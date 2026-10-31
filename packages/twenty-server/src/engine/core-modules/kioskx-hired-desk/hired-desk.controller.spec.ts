import { type Request } from 'express';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { HiredDeskController } from './hired-desk.controller';
import { HiredDeskService } from './hired-desk.service';
import { HIRED_WORKSPACE } from './hired-policy';

jest.mock(
  'src/engine/core-modules/auth/token/services/access-token.service',
  () => ({ AccessTokenService: class {} }),
);
jest.mock('./hired-desk.service', () => ({ HiredDeskService: class {} }));
const tokens = {
  validateToken: jest.fn(),
  validateTokenByRequest: jest.fn(() => {
    throw new Error('Gate must not decide session');
  }),
};
const controller = new HiredDeskController(
  tokens as unknown as AccessTokenService,
  {} as HiredDeskService,
);
beforeEach(() => jest.clearAllMocks());
it('returns hired false without a token and never invokes the request gate', async () => {
  await expect(controller.session({ headers: {} } as Request)).resolves.toEqual(
    { hired: false },
  );
  expect(tokens.validateToken).not.toHaveBeenCalled();
  expect(tokens.validateTokenByRequest).not.toHaveBeenCalled();
});
it.each(['support@kiosk-x.ai', 'admin@example.test'])(
  'resolves verified identity for %s without the gate',
  async (email) => {
    tokens.validateToken.mockResolvedValue({
      user: { email },
      workspace: { id: HIRED_WORKSPACE },
    });
    await expect(
      controller.session({
        headers: { authorization: 'Bearer fixture-token' },
      } as Request),
    ).resolves.toEqual({ hired: email === 'support@kiosk-x.ai' });
    expect(tokens.validateToken).toHaveBeenCalledWith('fixture-token');
    expect(tokens.validateTokenByRequest).not.toHaveBeenCalled();
  },
);
it('does not turn a failed token validation into admin access', async () => {
  tokens.validateToken.mockRejectedValue(new Error('Invalid token'));
  await expect(
    controller.session({
      headers: { authorization: 'Bearer invalid' },
    } as Request),
  ).rejects.toThrow('Invalid token');
});

it('accepts only opaque email IDs and body, never a client recipient', async () => {
  tokens.validateToken.mockResolvedValue({
    user: { email: 'support@kiosk-x.ai' },
    workspace: { id: HIRED_WORKSPACE },
  });
  const desk = { email: jest.fn(async () => ({ status: 'sent' })) };
  const api = new HiredDeskController(
    tokens as unknown as AccessTokenService,
    desk as unknown as HiredDeskService,
  );
  const request = {
    headers: { authorization: 'Bearer fixture-token' },
  } as Request;
  const input = {
    leadId: '11111111-1111-4111-a111-111111111111',
    requestId: '22222222-2222-4222-a222-222222222222',
    body: 'Hello',
  };
  expect(await api.email(request, input)).toEqual({ status: 'sent' });
  for (const invalid of [
    { ...input, to: 'extra@example.test' },
    { ...input, body: '' },
    { ...input, body: 'x'.repeat(10001) },
    { ...input, requestId: 'no' },
  ]) {
    await expect(api.email(request, invalid)).rejects.toThrow();
  }
  expect(desk.email).toHaveBeenCalledTimes(1);
});
it('does not capture an admin session or authorize the hired action for them', async () => {
  tokens.validateToken.mockResolvedValue({
    user: { email: 'admin@example.test' },
    workspace: { id: HIRED_WORKSPACE },
  });
  await expect(
    controller.email(
      { headers: { authorization: 'Bearer fixture-token' } } as Request,
      {},
    ),
  ).rejects.toThrow();
});

it.each(['missing token', 'invalid token', 'other user', 'other workspace'])(
  'rejects bridge access with %s before touching the service',
  async (failure) => {
    const desk = { bridgeConfig: jest.fn(), bridge: jest.fn() };
    const api = new HiredDeskController(
      tokens as unknown as AccessTokenService,
      desk as unknown as HiredDeskService,
    );
    const request = {
      headers: failure === 'missing token' ? {} : { authorization: 'Bearer fixture-token' },
    } as Request;
    if (failure === 'invalid token') tokens.validateToken.mockRejectedValue(new Error('Invalid token'));
    else tokens.validateToken.mockResolvedValue({
      user: { email: failure === 'other user' ? 'admin@example.test' : 'support@kiosk-x.ai' },
      workspace: { id: failure === 'other workspace' ? 'another-workspace' : HIRED_WORKSPACE },
    });
    await expect(api.voiceConfig(request)).rejects.toThrow();
    await expect(api.voiceBridge(request, { action: 'poll' })).rejects.toThrow();
    expect(desk.bridgeConfig).not.toHaveBeenCalled();
    expect(desk.bridge).not.toHaveBeenCalled();
  },
);

it('allows a verified hired identity to pair and rejects oversized bridge payloads', async () => {
  tokens.validateToken.mockResolvedValue({
    user: { email: 'support@kiosk-x.ai' },
    workspace: { id: HIRED_WORKSPACE },
  });
  const desk = {
    bridgeConfig: jest.fn(async () => ({ enabled: true })),
    bridge: jest.fn(async () => ({ status: 'connected' })),
  };
  const api = new HiredDeskController(
    tokens as unknown as AccessTokenService,
    desk as unknown as HiredDeskService,
  );
  const request = { headers: { authorization: 'Bearer fixture-token' } } as Request;
  await expect(api.voiceConfig(request)).resolves.toEqual({ enabled: true });
  await expect(api.voiceBridge(request, { action: 'connect' })).resolves.toEqual({ status: 'connected' });
  await expect(api.voiceBridge(request, { publicKey: 'x'.repeat(5001) })).rejects.toThrow();
  expect(desk.bridge).toHaveBeenCalledTimes(1);
});
