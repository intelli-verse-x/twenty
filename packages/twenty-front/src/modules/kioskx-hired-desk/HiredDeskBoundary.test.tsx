/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { HiredDeskBoundary } from './HiredDeskBoundary';

let mockPair: { accessOrWorkspaceAgnosticToken: { token: string } } | null;
const mockSetPair = jest.fn();
jest.mock('@/auth/states/tokenPairState', () => ({ tokenPairState: {} }));
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => mockPair,
}));
jest.mock('@/ui/utilities/state/jotai/hooks/useSetAtomState', () => ({
  useSetAtomState: () => mockSetPair,
}));
jest.mock('@/auth/utils/clearSessionLocalStorageKeys', () => ({
  clearSessionLocalStorageKeys: jest.fn(),
}));
jest.mock('~/config', () => ({
  REACT_APP_SERVER_BASE_URL: 'https://crm.intelli-verse-x.ai',
}));
const child = jest.fn(() => <div>People Companies Notes Workflows</div>);
const Child = child;
const reply = (body: unknown) => ({ ok: true, json: async () => body });
beforeEach(() => {
  mockPair = { accessOrWorkspaceAgnosticToken: { token: 'fixture-token' } };
  child.mockClear();
});
it('never mounts CRM providers while resolving or when hired; every deep link becomes the desk', async () => {
  window.history.replaceState(null, '', '/objects/people/private-record');
  global.fetch = jest.fn(async (url) =>
    reply(
      String(url).endsWith('/session')
        ? { hired: true }
        : {
            unavailable: false,
            leads: [
              {
                id: 'lead',
                label: 'Inquiry fixture',
                inquiry: 'A cabinet please',
                canCall: false,
              },
            ],
          },
    ),
  ) as jest.Mock;
  render(
    <HiredDeskBoundary>
      <Child />
    </HiredDeskBoundary>,
  );
  expect(child).not.toHaveBeenCalled();
  await screen.findByText('Inquiry fixture');
  for (const path of ['session', 'leads'])
    expect(global.fetch).toHaveBeenCalledWith(
      `${window.location.origin}/kioskx-hired-desk/${path}`,
      expect.any(Object),
    );
  expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  expect(child).not.toHaveBeenCalled();
  expect(document.body.innerHTML).not.toContain('People');
});
it('fails closed before providers mount when the session cannot be verified', async () => {
  global.fetch = jest.fn(async () => {
    throw new Error('offline');
  });
  render(
    <HiredDeskBoundary>
      <Child />
    </HiredDeskBoundary>,
  );
  await screen.findByText('Inquiries are unavailable. Sign in again to retry.');
  expect(child).not.toHaveBeenCalled();
});
it('mounts the unchanged admin CRM only after the server confirms it', async () => {
  global.fetch = jest.fn(async () => reply({ hired: false })) as jest.Mock;
  render(
    <HiredDeskBoundary>
      <Child />
    </HiredDeskBoundary>,
  );
  expect(child).not.toHaveBeenCalled();
  await screen.findByText('People Companies Notes Workflows');
});
it('removes the old admin surface immediately when the token changes', async () => {
  global.fetch = jest.fn(async () => reply({ hired: false })) as jest.Mock;
  const { rerender } = render(
    <HiredDeskBoundary>
      <Child />
    </HiredDeskBoundary>,
  );
  await screen.findByText('People Companies Notes Workflows');
  mockPair = { accessOrWorkspaceAgnosticToken: { token: 'new-hired-token' } };
  global.fetch = jest.fn(() => new Promise(() => {}));
  rerender(
    <HiredDeskBoundary>
      <Child />
    </HiredDeskBoundary>,
  );
  expect(
    screen.queryByText('People Companies Notes Workflows'),
  ).not.toBeInTheDocument();
});
it('keeps login reachable without a session', () => {
  mockPair = null;
  render(
    <HiredDeskBoundary>
      <div>Sign in</div>
    </HiredDeskBoundary>,
  );
  expect(screen.getByText('Sign in')).toBeInTheDocument();
});

it.each([{}, { hired: null }, { hired: 'false' }])(
  'keeps CRM hidden when hired cannot be read: %j',
  async (value) => {
    global.fetch = jest.fn(async () => reply(value)) as jest.Mock;
    render(
      <HiredDeskBoundary>
        <Child />
      </HiredDeskBoundary>,
    );
    await screen.findByText(
      'Inquiries are unavailable. Sign in again to retry.',
    );
    expect(child).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Sign out' }),
    ).toBeInTheDocument();
  },
);
