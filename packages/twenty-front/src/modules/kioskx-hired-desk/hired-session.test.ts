/** @jest-environment jsdom */
import { isHiredSession } from './hired-session';

jest.mock('~/config', () => ({
  REACT_APP_SERVER_BASE_URL: 'https://crm.intelli-verse-x.ai',
}));
it.each([true, false])('checks identity on the page origin: hired=%s', async (hired) => {
  global.fetch = jest.fn(async () => ({
    ok: true, json: async () => ({ hired }),
  })) as jest.Mock;
  expect(await isHiredSession('fixture-token')).toBe(hired);
  expect(global.fetch).toHaveBeenCalledWith(
    `${window.location.origin}/kioskx-hired-desk/session`,
    expect.objectContaining({ cache: 'no-store' }),
  );
});
it.each([{ ok: false }, { ok: true, json: async () => ({}) }])(
  'rejects an unreadable session', async (response) => {
    global.fetch = jest.fn(async () => response) as jest.Mock;
    await expect(isHiredSession('fixture-token')).rejects.toThrow('Session unavailable');
  },
);
