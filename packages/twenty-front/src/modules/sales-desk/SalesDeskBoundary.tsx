import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { tokenPairState } from '@/auth/states/tokenPairState';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { clearSessionLocalStorageKeys } from '@/auth/utils/clearSessionLocalStorageKeys';
import { BaseThemeProvider } from '@/ui/theme/components/BaseThemeProvider';
import { SalesDesk, type SalesResponse, type SalesRequest } from './SalesDesk';

// Mounted only in HiredDeskBoundary's hired:false/signed-out children.
export const SalesDeskBoundary = ({ children }: { children: ReactNode }) => {
  const pair = useAtomStateValue(tokenPairState);
  const setPair = useSetAtomState(tokenPairState);
  const token = pair?.accessOrWorkspaceAgnosticToken?.token;
  const [session, setSession] = useState<{
    token: string;
    value: SalesResponse;
  }>();
  const [failed, setFailed] = useState<string>();
  const request: SalesRequest = useCallback(
    async (path, body) => {
      const response = await fetch(
        `${window.location.origin}/sales-desk/${path}`,
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
      if (!response.ok) throw new Error('Sales desk unavailable');
      return response.json();
    },
    [token],
  );
  useEffect(() => {
    if (!token) return;
    let active = true;
    request('session')
      .then((value) => {
        if (
          typeof value.allowed !== 'boolean' ||
          (value.allowed && !value.channels)
        )
          throw new Error('Invalid session');
        if (active) setSession({ token, value });
      })
      .catch(() => {
        if (active) setFailed(token);
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
  if (session?.token !== token)
    return (
      <main>
        <p role="status">
          {failed === token
            ? 'Sales desk is unavailable. Sign in again to retry.'
            : 'Loading…'}
        </p>
        {failed === token && <button onClick={signOut}>Sign out</button>}
      </main>
    );
  if (!session.value.allowed) return children;
  return (
    <BaseThemeProvider>
      <SalesDesk
        key={token}
        request={request}
        channels={session.value.channels!}
        onSignOut={signOut}
      />
    </BaseThemeProvider>
  );
};
