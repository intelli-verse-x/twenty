import { useCallback } from 'react';

import { currentUserState } from '@/auth/states/currentUserState';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useLingui } from '@lingui/react/macro';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

const ADMIN_PORTAL_URL =
  (typeof window !== 'undefined' &&
    window._env_?.REACT_APP_ADMIN_PORTAL_URL) ||
  'https://admin.intelli-verse-x.ai';

export const useHandleResetPassword = () => {
  const { enqueueErrorSnackBar } = useSnackBar();
  const currentUser = useAtomStateValue(currentUserState);
  const { t } = useLingui();

  const handleResetPassword = useCallback(
    (email = currentUser?.email) => {
      return async () => {
        if (!email) {
          enqueueErrorSnackBar({
            message: t`Invalid email`,
          });
          return;
        }

        const portal = String(ADMIN_PORTAL_URL).replace(/\/$/, '');
        window.location.assign(
          `${portal}/tool-reset-password?tool=crm&email=${encodeURIComponent(email)}`,
        );
      };
    },
    [currentUser?.email, enqueueErrorSnackBar, t],
  );

  return { handleResetPassword };
};
