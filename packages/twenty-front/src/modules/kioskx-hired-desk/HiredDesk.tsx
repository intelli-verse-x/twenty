import { useEffect, useState } from 'react';

export type HiredLead = {
  id: string;
  label: string;
  inquiry: string;
  canCall: boolean;
};
export type DeskRequest = (path: string, body?: unknown) => Promise<{
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
            value.unavailable || !Array.isArray(value.leads) ? { unavailable: true, leads: [] } : { unavailable: false, leads: value.leads },
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
        fontFamily: 'sans-serif',
        overflowWrap: 'anywhere',
      }}
    >
      <header>
        <h1>KioskX inquiries</h1>
        <button onClick={onSignOut}>Sign out</button>
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
            style={{ padding: '20px 0', borderBottom: '1px solid #999' }}
          >
            <h2>{lead.label}</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{lead.inquiry}</p>
            {lead.canCall && (
              <button
                disabled={!!calls[lead.id]}
                onClick={() => void call(lead.id)}
              >
                Call
              </button>
            )}
            {calls[lead.id] && <p role="status">{calls[lead.id]}</p>}
          </article>
        ))
      )}
    </main>
  );
};
