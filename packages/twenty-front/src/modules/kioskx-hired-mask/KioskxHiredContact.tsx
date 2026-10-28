import { gql } from '@apollo/client';
import { useMutation, useQuery } from '@apollo/client/react';
import { useRef, useState } from 'react';

const CONTACT = gql`
  query KioskxDeskContact($personId: UUID!) {
    kioskxDeskContact(personId: $personId) {
      unavailable
      hasEmail
      hasPhone
      emailAvailable
      callAvailable
      entries {
        kind
        text
      }
    }
  }
`;
const ACTION = gql`
  mutation KioskxDeskAction($input: KioskxDeskActionInput!) {
    kioskxDeskAction(input: $input) {
      ok
      status
    }
  }
`;
type Contact = {
  unavailable: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  emailAvailable: boolean;
  callAvailable: boolean;
  entries: { kind: string; text: string }[];
};
type Result = { ok: boolean; status: string };

export const KioskxContactChip = ({
  label,
  disabled,
  onClick,
}: {
  label: 'Email' | 'Call';
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    style={{
      color: 'inherit',
      background: 'transparent',
      border: '1px solid #888',
      borderRadius: 20,
      padding: '8px 14px',
      marginRight: 8,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
  >
    {label}{' '}
    <span
      aria-hidden="true"
      style={{ filter: 'blur(3px)', userSelect: 'none' }}
    >
      ••••••
    </span>
  </button>
);

export const KioskxHiredContact = ({ personId }: { personId: string }) => {
  const { data, error } = useQuery<{ kioskxDeskContact: Contact | null }>(
    CONTACT,
    {
      variables: { personId },
      fetchPolicy: 'no-cache',
      pollInterval: 30000,
    },
  );
  const [act, { loading }] = useMutation<{ kioskxDeskAction: Result }>(ACTION);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('');
  const request = useRef<string | null>(null);
  const busy = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const contact = data?.kioskxDeskContact;
  if (error || !contact) return null;
  if (contact.unavailable)
    return (
      <p role="status">
        Contact details are unavailable. Please try again shortly.
      </p>
    );

  const submit = async (action: 'email' | 'call') => {
    if (busy.current || uncertain) return;
    busy.current = true;
    request.current ??= crypto.randomUUID();
    try {
      const response = await act({
        variables: {
          input: {
            personId,
            requestId: request.current,
            action,
            ...(action === 'email' ? { subject, body } : {}),
          },
        },
      });
      const result = response.data?.kioskxDeskAction;
      if (result?.ok) {
        setStatus(action === 'email' ? 'Email sent.' : 'Call started.');
        setComposing(false);
        setSubject('');
        setBody('');
        request.current = null;
      } else if (result?.status === 'unavailable') {
        setStatus('Contact is unavailable. Ask your admin for help.');
        request.current = null;
      } else {
        setStatus(
          'Already submitted or delivery is unconfirmed. Ask your admin to check before trying again.',
        );
        setUncertain(true);
      }
    } catch {
      setStatus(
        'Delivery is unconfirmed. Ask your admin to check before trying again.',
      );
      setUncertain(true);
    } finally {
      busy.current = false;
    }
  };

  return (
    <section aria-label="Contact through CRM" style={{ padding: 16 }}>
      {contact.hasEmail && (
        <KioskxContactChip
          label="Email"
          disabled={loading || uncertain || !contact.emailAvailable}
          onClick={() => setComposing(true)}
        />
      )}
      {contact.hasPhone && (
        <KioskxContactChip
          label="Call"
          disabled={loading || uncertain || !contact.callAvailable}
          onClick={() => void submit('call')}
        />
      )}
      {contact.hasEmail && !contact.emailAvailable && (
        <p>Email is unavailable. Ask your admin to connect the shared inbox.</p>
      )}
      {contact.hasPhone && !contact.callAvailable && (
        <p>Calling is unavailable. Ask your admin for help.</p>
      )}
      {composing && (
        <form
          style={{ display: 'grid', gap: 12, maxWidth: 560, marginTop: 16 }}
          onSubmit={(event) => {
            event.preventDefault();
            void submit('email');
          }}
        >
          <label>
            Subject{' '}
            <input
              required
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label>
            Message{' '}
            <textarea
              required
              maxLength={10000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button disabled={loading || uncertain} type="submit">
            Send email
          </button>
          <button type="button" onClick={() => setComposing(false)}>
            Cancel
          </button>
        </form>
      )}
      <p role="status">{status}</p>
      {contact.entries.map((entry, index) => (
        <article key={index}>
          <h3>{entry.kind}</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{entry.text}</p>
        </article>
      ))}
    </section>
  );
};
