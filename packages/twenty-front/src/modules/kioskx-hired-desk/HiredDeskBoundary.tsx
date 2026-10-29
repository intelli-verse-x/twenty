import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { tokenPairState } from '@/auth/states/tokenPairState';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { clearSessionLocalStorageKeys } from '@/auth/utils/clearSessionLocalStorageKeys';
import { REACT_APP_SERVER_BASE_URL } from '~/config';
import { HiredDesk } from './HiredDesk';

// Resolve the server's identity before mounting any CRM data providers or routes.
// A stale/local user record never authorizes the normal CRM.
export const HiredDeskBoundary = ({ children }: { children: ReactNode }) => {
  const setPair = useSetAtomState(tokenPairState);
  const pair = useAtomStateValue(tokenPairState);
  const token = pair?.accessOrWorkspaceAgnosticToken?.token;
  const [session, setSession] = useState<{ token: string; hired: boolean }>();
  const [failedToken, setFailedToken] = useState<string>();
  const request = useCallback(
    async (path: string, body?: unknown) => {
      const response = await fetch(
        `${REACT_APP_SERVER_BASE_URL}/kioskx-hired-desk/${path}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      if (!response.ok) throw new Error('Desk unavailable');
      return response.json();
    },
    [token],
  );
  useEffect(() => {
    if (!token) return;
    let active = true;
    request('session')
      .then((value) => {
        if (typeof value.hired !== 'boolean')
          throw new Error('Invalid session');
        if (active) setSession({ token, hired: value.hired });
      })
      .catch(() => {
        if (active) setFailedToken(token);
      });
    return () => {
      active = false;
    };
  }, [token, request]);
  const signOut = () => {
    clearSessionLocalStorageKeys();
    setPair(null);
    window.location.assign('/');
  };
  if (!token) return children;
  if (session?.token === token)
    return session.hired ? (
      <HiredDesk key={token} request={request} onSignOut={signOut} />
    ) : (
      children
    );
  return (
    <main>
      <p role="status">
        {failedToken === token
          ? 'Inquiries are unavailable. Sign in again to retry.'
          : 'Loading…'}
      </p>
      {failedToken === token && <button onClick={signOut}>Sign out</button>}
    </main>
  );
};
