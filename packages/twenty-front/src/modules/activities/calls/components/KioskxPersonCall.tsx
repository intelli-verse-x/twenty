import { useMutation, useQuery } from '@apollo/client/react';
import gql from 'graphql-tag';
import { useEffect } from 'react';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { KioskxCallControl, type KioskxCallStatus } from './KioskxCallControl';

const STATUS = gql`
  query KioskxCallStatus($personId: String!) {
    kioskxCallStatus(personId: $personId) {
      available
      status
      message
    }
  }
`;
const START = gql`
  mutation StartKioskxCall($personId: String!, $requestId: String!) {
    startKioskxCall(personId: $personId, requestId: $requestId) {
      available
      status
      message
    }
  }
`;

export const KioskxPersonCall = ({ personId }: { personId: string }) => {
  const hostname = window.location.hostname;
  const client = useApolloCoreClient();
  const { data, refetch, startPolling, stopPolling } = useQuery<{
    kioskxCallStatus: KioskxCallStatus;
  }>(STATUS, {
    variables: { personId },
    skip: hostname !== 'kioskx.crm.intelli-verse-x.ai',
    fetchPolicy: 'network-only',
  });
  const [start] = useMutation<{ startKioskxCall: KioskxCallStatus }>(START);
  const status = data?.kioskxCallStatus.status;
  useEffect(() => {
    if (['queued', 'dialing', 'pending'].includes(status || ''))
      startPolling(3000);
    else stopPolling();
    if (status === 'complete')
      void client.refetchQueries({ include: 'active' });
    return stopPolling;
  }, [status, startPolling, stopPolling, client]);
  return (
    <KioskxCallControl
      hostname={hostname}
      state={data?.kioskxCallStatus}
      onCall={async () => {
        try {
          const result = await start({
            variables: { personId, requestId: crypto.randomUUID() },
          });
          if (
            !result.data ||
            result.data.startKioskxCall.status === 'unavailable'
          )
            throw new Error('Calling unavailable');
        } finally {
          await refetch();
        }
      }}
    />
  );
};
