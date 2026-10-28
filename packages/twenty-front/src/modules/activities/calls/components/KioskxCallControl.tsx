import { useState } from 'react';
import { Button } from 'twenty-ui/input';
import { IconPhone } from 'twenty-ui/display';

export type KioskxCallStatus = {
  available: boolean;
  status: string;
  message: string;
};

export const KioskxCallControl = ({
  hostname,
  state,
  onCall,
}: {
  hostname: string;
  state?: KioskxCallStatus;
  onCall: () => Promise<void>;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  if (hostname !== 'kioskx.crm.intelli-verse-x.ai' || !state?.available)
    return null;
  const busy =
    submitting || ['queued', 'dialing', 'pending'].includes(state.status);
  return (
    <>
      <Button
        title={busy ? 'Calling…' : 'Call'}
        Icon={IconPhone}
        size="small"
        variant="secondary"
        disabled={busy || state.status === 'failed'}
        onClick={async () => {
          setSubmitting(true);
          setError('');
          try {
            await onCall();
          } catch {
            setError('Call could not be confirmed. Check Voice Studio.');
          } finally {
            setSubmitting(false);
          }
        }}
      />
      {(error || state.message) && (
        <span
          role={
            error || state.status === 'failed' || state.status === 'unavailable'
              ? 'alert'
              : 'status'
          }
        >
          {error || state.message}
        </span>
      )}
    </>
  );
};
