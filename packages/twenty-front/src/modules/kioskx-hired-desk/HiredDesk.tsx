import { useEffect, useState } from 'react';

export type HiredLead = {
  id: string;
  label: string;
  inquiry: string;
  email: string;
  phone: string;
  canCall: boolean;
};
export type DeskRequest = (
  path: string,
  body?: unknown,
) => Promise<{
  unavailable?: boolean;
  leads?: HiredLead[];
  status?: string;
}>;

export const HiredDesk = ({
  request,
  onSignOut,
}: {
  request: DeskRequest;
  onSignOut: () => void;
}) => {
  const [result, setResult] = useState<{
    unavailable: boolean;
    leads: HiredLead[];
  }>();
  const [calls, setCalls] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    request('leads')
      .then((value) => {
        if (active)
          setResult(
            value.unavailable || !Array.isArray(value.leads)
              ? { unavailable: true, leads: [] }
              : { unavailable: false, leads: value.leads },
          );
      })
      .catch(() => {
        if (active) setResult({ unavailable: true, leads: [] });
      });
    return () => {
      active = false;
    };
  }, [request]);
  const call = async (id: string) => {
    setCalls((previous) => ({ ...previous, [id]: 'Call requested.' }));
    try {
      const response = await request('call', {
        leadId: id,
        requestId: crypto.randomUUID(),
      });
      const message =
        response.status === 'complete'
          ? 'Call finished.'
          : response.status === 'unavailable'
            ? 'Calling is unavailable.'
            : 'Call status is unavailable. Contact your admin before trying again.';
      setCalls((previous) => ({ ...previous, [id]: message }));
    } catch {
      setCalls((previous) => ({
        ...previous,
        [id]: 'Call status is unavailable. Contact your admin before trying again.',
      }));
    }
  };
  return (
    <main
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        color: '#202733',
        background: '#f4f6f8',
        minHeight: '100vh',
        boxSizing: 'border-box',
        width: '100%',
        lineHeight: 1.6,
        overflowWrap: 'anywhere',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 24,
        }}
      >
        <h1 style={{ fontSize: 28, margin: 0 }}>KioskX inquiries</h1>
        <button
          style={{
            padding: '10px 18px',
            border: '1px solid #677384',
            borderRadius: 8,
            background: 'white',
            color: '#202733',
            cursor: 'pointer',
            font: 'inherit',
          }}
          onClick={onSignOut}
        >
          Sign out
        </button>
      </header>
      {!result ? (
        <p role="status">Loading inquiries…</p>
      ) : result.unavailable ? (
        <p role="status">Inquiries are unavailable. Try again later.</p>
      ) : result.leads.length === 0 ? (
        <p>No inquiries yet.</p>
      ) : (
        result.leads.map((lead) => (
          <article
            key={lead.id}
            style={{
              padding: 24,
              marginBottom: 20,
              border: '1px solid #d8dee6',
              borderRadius: 12,
              background: 'white',
              boxShadow: '0 2px 6px #20273308',
            }}
          >
            <h2 style={{ fontSize: 20, margin: '0 0 16px' }}>{lead.label}</h2>
            <dl style={{ margin: '0 0 20px' }}>
              <dt style={{ fontWeight: 600 }}>Email</dt>
              <dd style={{ margin: '0 0 12px', userSelect: 'text' }}>
                {lead.email?.trim() || 'No email'}
              </dd>
              <dt style={{ fontWeight: 600 }}>Phone</dt>
              <dd style={{ margin: 0, userSelect: 'text' }}>
                {lead.phone?.trim() || 'No phone'}
              </dd>
            </dl>
            <div
              style={{
                borderTop: '1px solid #e2e6ec',
                paddingTop: 12,
                marginBottom: 20,
              }}
            >
              {lead.inquiry
                .split(/\r?\n|\|/)
                .map((line) => line.trim())
                .filter(Boolean)
                .filter((line) => !/^[-: ]+$/.test(line))
                .map((line, index) => (
                  <p
                    key={index}
                    style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}
                  >
                    {line}
                  </p>
                ))}
            </div>
            <button
              style={{
                padding: '10px 24px',
                border: '1px solid #aeb8c6',
                borderRadius: 8,
                font: 'inherit',
                fontWeight: 600,
                background: lead.canCall ? '#203f75' : '#edf0f4',
                color: lead.canCall ? 'white' : '#526071',
                cursor: lead.canCall ? 'pointer' : 'not-allowed',
              }}
              disabled={!lead.canCall || !!calls[lead.id]}
              onClick={() => void call(lead.id)}
            >
              Call
            </button>
            {!lead.canCall && (
              <p style={{ color: '#526071', marginBottom: 0 }}>
                Calling is off until Google Voice is connected. Use the phone
                number.
              </p>
            )}
            {calls[lead.id] && <p role="status">{calls[lead.id]}</p>}
          </article>
        ))
      )}
    </main>
  );
};
