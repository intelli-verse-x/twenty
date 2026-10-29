import { type Request } from 'express';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { HiredDeskController } from './hired-desk.controller';
import { HiredDeskService } from './hired-desk.service';
import { HIRED_WORKSPACE } from './hired-policy';

jest.mock('src/engine/core-modules/auth/token/services/access-token.service', () => ({ AccessTokenService: class {} }));
jest.mock('./hired-desk.service', () => ({ HiredDeskService: class {} }));
const tokens = {
  validateToken: jest.fn(),
  validateTokenByRequest: jest.fn(() => { throw new Error('Gate must not decide session'); }),
};
const controller = new HiredDeskController(
  tokens as unknown as AccessTokenService,
  {} as HiredDeskService,
);
beforeEach(() => jest.clearAllMocks());
it('returns hired false without a token and never invokes the request gate', async () => {
  await expect(controller.session({ headers: {} } as Request)).resolves.toEqual({ hired: false });
  expect(tokens.validateToken).not.toHaveBeenCalled();
  expect(tokens.validateTokenByRequest).not.toHaveBeenCalled();
});
it.each(['support@kiosk-x.ai', 'admin@example.test'])('resolves verified identity for %s without the gate', async (email) => {
  tokens.validateToken.mockResolvedValue({ user: { email }, workspace: { id: HIRED_WORKSPACE } });
  await expect(controller.session({ headers: { authorization: 'Bearer fixture-token' } } as Request)).resolves.toEqual({ hired: email === 'support@kiosk-x.ai' });
  expect(tokens.validateToken).toHaveBeenCalledWith('fixture-token');
  expect(tokens.validateTokenByRequest).not.toHaveBeenCalled();
});
it('does not turn a failed token validation into admin access', async () => {
  tokens.validateToken.mockRejectedValue(new Error('Invalid token'));
  await expect(controller.session({ headers: { authorization: 'Bearer invalid' } } as Request)).rejects.toThrow('Invalid token');
});
