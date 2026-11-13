/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { SalesDeskBoundary } from './SalesDeskBoundary';
import { HiredDeskBoundary } from '../kioskx-hired-desk/HiredDeskBoundary';

let mockPair: { accessOrWorkspaceAgnosticToken: { token: string } } | null;
jest.mock('@/auth/states/tokenPairState', () => ({ tokenPairState: {} }));
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => mockPair,
}));
jest.mock('@/ui/utilities/state/jotai/hooks/useSetAtomState', () => ({
  useSetAtomState: () => jest.fn(),
}));
jest.mock('@/auth/utils/clearSessionLocalStorageKeys', () => ({
  clearSessionLocalStorageKeys: jest.fn(),
}));
jest.mock('@/ui/theme/components/BaseThemeProvider', () => ({
  BaseThemeProvider: ({ children }: any) => children,
}));
jest.mock('twenty-ui/input', () => ({
  Button: ({ title, ariaLabel, variant: _v, accent: _a, ...props }: any) => (
    <button aria-label={ariaLabel} {...props}>
      {title}
    </button>
  ),
}));
jest.mock('twenty-ui/surfaces', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
}));
const channels = { email: false, voice: false, voiceStatus: 'Calling is off.' };
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });
const tree = () => (
  <HiredDeskBoundary>
    <SalesDeskBoundary>
      <div>Existing Twenty sign-in</div>
    </SalesDeskBoundary>
  </HiredDeskBoundary>
);
beforeEach(() => {
  mockPair = { accessOrWorkspaceAgnosticToken: { token: 'fixture-token' } };
});
it('signed-out visitors keep the existing sign-in without records or requests', () => {
  mockPair = null;
  global.fetch = jest.fn();
  render(tree());
  expect(screen.getByText('Existing Twenty sign-in')).toBeVisible();
  expect(
    screen.queryByRole('region', { name: 'Cleaning' }),
  ).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});
it('unlisted email keeps the CRM without queue reads', async () => {
  global.fetch = jest.fn(async (url) =>
    reply(
      String(url).includes('kioskx-hired-desk')
        ? { hired: false }
        : { allowed: false },
    ),
  ) as jest.Mock;
  render(tree());
  expect(await screen.findByText('Existing Twenty sign-in')).toBeVisible();
  expect(
    screen.queryByText('This desk is for the sales team.'),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
});
it('listed salesperson gets the four queues only after hired:false', async () => {
  global.fetch = jest.fn(async (url) =>
    reply(
      String(url).includes('kioskx-hired-desk')
        ? { hired: false }
        : String(url).endsWith('/session')
          ? { allowed: true, channels }
          : { rows: [] },
    ),
  ) as jest.Mock;
  render(tree());
  expect(await screen.findByRole('region', { name: 'Cleaning' })).toBeVisible();
  for (const name of ['Cars', 'Jobs', 'Turo'])
    expect(screen.getByRole('region', { name })).toBeVisible();
  expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain(
    '/kioskx-hired-desk/session',
  );
});
it('hired sessions render only the unchanged masked hired desk', async () => {
  global.fetch = jest.fn(async (url) =>
    reply(
      String(url).endsWith('/session')
        ? { hired: true }
        : {
            leads: [
              {
                id: 'fixture-hired',
                label: 'Fixture Hired Inquiry',
                inquiry: 'Cabinet inquiry',
                email: '••••@••••',
                phone: '••• ••• ••••',
                canCall: false,
              },
            ],
          },
    ),
  ) as jest.Mock;
  render(tree());
  expect(await screen.findByText('Fixture Hired Inquiry')).toBeVisible();
  expect(screen.getByText('••••@••••')).toBeVisible();
  expect(
    screen.queryByRole('region', { name: 'Cleaning' }),
  ).not.toBeInTheDocument();
  expect(
    (global.fetch as jest.Mock).mock.calls.every(
      ([url]) => !String(url).includes('/sales-desk/'),
    ),
  ).toBe(true);
});
it('drops the previous queues immediately on token change', async () => {
  global.fetch = jest.fn(async () =>
    reply({ allowed: true, channels, rows: [] }),
  ) as jest.Mock;
  const view = render(<SalesDeskBoundary>Sign in</SalesDeskBoundary>);
  await screen.findByRole('region', { name: 'Cleaning' });
  mockPair = { accessOrWorkspaceAgnosticToken: { token: 'different-fixture' } };
  global.fetch = jest.fn(() => new Promise(() => {}));
  view.rerender(<SalesDeskBoundary>Sign in</SalesDeskBoundary>);
  expect(
    screen.queryByRole('region', { name: 'Cleaning' }),
  ).not.toBeInTheDocument();
});
it('fails closed on an invalid sales session response', async () => {
  global.fetch = jest.fn(async () => reply({ allowed: 'yes' })) as jest.Mock;
  render(<SalesDeskBoundary>Sign in</SalesDeskBoundary>);
  expect(
    await screen.findByText(
      'Sales desk is unavailable. Sign in again to retry.',
    ),
  ).toBeVisible();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
});
