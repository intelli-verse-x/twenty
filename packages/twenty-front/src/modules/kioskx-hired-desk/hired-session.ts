import { REACT_APP_SERVER_BASE_URL } from '~/config';
export const isHiredSession = async (token: string): Promise<boolean> => {
  const response = await fetch(
    `${REACT_APP_SERVER_BASE_URL}/kioskx-hired-desk/session`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Session unavailable');
  const value = await response.json();
  if (typeof value.hired !== 'boolean') throw new Error('Session unavailable');
  return value.hired;
};
