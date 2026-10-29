import { useEffect, useRef, useState } from 'react';
import { Button } from 'twenty-ui/input';
import { Card } from 'twenty-ui/surfaces';
import './HiredDesk.css';

export type DeskMessage = { id: string; body: string; createdAt: string };
export type HiredLead = {
  id: string;
  label: string;
  company?: string;
  inquiry: string;
  email: string;
  phone: string;
  canCall: boolean;
  messages?: DeskMessage[];
};
export type DeskRequest = (
  path: string,
  body?: unknown,
) => Promise<{
  unavailable?: boolean;
  leads?: HiredLead[];
  status?: string;
  message?: DeskMessage;
}>;

const InquiryCard = ({
  lead,
  request,
}: {
  lead: HiredLead;
  request: DeskRequest;
}) => {
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [messages, setMessages] = useState(lead.messages ?? []);
  const [emailStatus, setEmailStatus] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [sending, setSending] = useState(false);
  // Block duplicate clicks synchronously, including before React's next render.
  const emailClaim = useRef<string | undefined>(undefined);
  const callClaim = useRef<string | undefined>(undefined);
  const call = async () => {
    if (callClaim.current || !lead.canCall) return;
    callClaim.current = crypto.randomUUID();
    setCallStatus('Calling…');
    try {
      const response = await request('call', {
        leadId: lead.id,
        requestId: callClaim.current,
      });
      setCallStatus(
        response.status === 'complete'
          ? 'Call finished · Transcript saved'
          : response.status === 'unavailable'
            ? 'Calling is unavailable.'
            : 'Call status is unavailable. Contact your admin before trying again.',
      );
    } catch {
      setCallStatus(
        'Call status is unavailable. Contact your admin before trying again.',
      );
    }
  };
  const send = async () => {
    if (emailClaim.current || !body.trim()) return;
    emailClaim.current = crypto.randomUUID();
    setSending(true);
    setEmailStatus('Sending…');
    try {
      const response = await request('email', {
        leadId: lead.id,
        requestId: emailClaim.current,
        body,
      });
      if (response.status === 'sent' && response.message) {
        setMessages((previous) => [...previous, response.message!]);
        setBody('');
        setComposing(false);
        setEmailStatus('Email sent');
        emailClaim.current = undefined;
      } else if (response.status === 'unavailable') {
        setEmailStatus('Email is unavailable.');
        emailClaim.current = undefined;
      } else {
        setEmailStatus(
          'Email status is unavailable. Contact your admin before trying again.',
        );
      }
    } catch {
      setEmailStatus(
        'Email status is unavailable. Contact your admin before trying again.',
      );
    } finally {
      setSending(false);
    }
  };
  const fields = lead.inquiry
    .split(/\r?\n|\|/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[-: ]+$/.test(line))
    .map((line) => {
      const colon = line.indexOf(':');
      return colon > 0 && colon < 45
        ? [
            line.slice(0, colon).replace(/\*\*/g, ''),
            line.slice(colon + 1).trim(),
          ]
        : ['Inquiry', line];
    })
    .filter(
      ([label]) =>
        !/^(email|phone(?: number)?|(?:full )?name|company(?: name)?)$/i.test(
          label,
        ),
    );
  return (
    <article aria-label={lead.label}>
      <Card className="hired-card" rounded fullWidth>
        <div className="hired-card-heading">
          <div className="hired-avatar" aria-hidden="true">
            {lead.label.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2>{lead.label}</h2>
            {lead.company && <p className="hired-muted">{lead.company}</p>}
          </div>
          <span className="hired-source">Inquiry</span>
        </div>
        <div className="hired-card-main">
          <dl className="hired-fields">
            <dt>Email</dt>
            <dd>{lead.email?.trim() || 'No email'}</dd>
            <dt>Phone</dt>
            <dd>{lead.phone?.trim() || 'No phone'}</dd>
            {fields.map(([label, value], index) => (
              <div className="hired-field" key={index}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="hired-actions">
            <Button
              title="Send email"
              ariaLabel="Send email"
              variant="primary"
              accent="blue"
              onClick={() => setComposing(true)}
            />
            <Button
              title="Call"
              ariaLabel="Call"
              variant="primary"
              disabled={!lead.canCall || !!callStatus}
              onClick={() => void call()}
            />
          </div>
          {!lead.canCall && (
            <p className="hired-muted">
              Calling is off until Google Voice is connected.
            </p>
          )}
          {callStatus && <p role="status">{callStatus}</p>}
          {composing && (
            <form
              className="hired-compose"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <p>To: {lead.label}</p>
              <label htmlFor={`email-${lead.id}`}>Message</label>
              <textarea
                id={`email-${lead.id}`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={10000}
                rows={5}
                required
                autoFocus
                disabled={sending || !!emailClaim.current}
              />
              <div className="hired-actions">
                <Button
                  title={sending ? 'Sending…' : 'Send'}
                  ariaLabel={sending ? 'Sending…' : 'Send'}
                  type="submit"
                  variant="primary"
                  accent="blue"
                  disabled={!body.trim() || sending || !!emailClaim.current}
                />
                <Button
                  title="Cancel"
                  ariaLabel="Cancel"
                  type="button"
                  variant="secondary"
                  disabled={sending}
                  onClick={() => setComposing(false)}
                />
              </div>
            </form>
          )}
          {emailStatus && <p role="status">{emailStatus}</p>}
          {messages.length > 0 && (
            <section className="hired-thread" aria-label="Email thread">
              <h3>Email thread</h3>
              {messages.map((message) => (
                <div className="hired-message" key={message.id}>
                  <p className="hired-muted">
                    Sent ·{' '}
                    <time dateTime={message.createdAt}>
                      {new Date(message.createdAt).toLocaleString()}
                    </time>
                  </p>
                  <p>{message.body}</p>
                </div>
              ))}
            </section>
          )}
        </div>
      </Card>
    </article>
  );
};

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
  const [search, setSearch] = useState('');
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
  const visible = result?.leads.filter((lead) =>
    `${lead.label} ${lead.company ?? ''} ${lead.inquiry}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <main className="hired-desk">
      <aside className="hired-sidebar">
        <strong>KioskX</strong>
        <span className="hired-muted">Inquiry desk</span>
        <div className="hired-nav" aria-current="page">
          Inbox
        </div>
      </aside>
      <div className="hired-workspace">
        <header className="hired-toolbar">
          <h1>
            Inquiries{' '}
            <span className="hired-count">
              {result?.unavailable ? '—' : (result?.leads.length ?? '…')}
            </span>
          </h1>
          <Button
            title="Sign out"
            ariaLabel="Sign out"
            variant="secondary"
            onClick={onSignOut}
          />
        </header>
        <div className="hired-content">
          {!result ? (
            <p role="status">Loading inquiries…</p>
          ) : result.unavailable ? (
            <p role="status">Inquiries are unavailable. Try again later.</p>
          ) : (
            <>
              <div className="hired-list-toolbar">
                <span>Contact form & newsletter</span>
                <input
                  aria-label="Search inquiries"
                  placeholder="Search inquiries"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  type="search"
                />
              </div>
              {result.leads.length === 0 ? (
                <p>No inquiries yet.</p>
              ) : (
                result.leads.map((lead) => (
                  <div key={lead.id} hidden={!visible?.includes(lead)}>
                    <InquiryCard lead={lead} request={request} />
                  </div>
                ))
              )}
              {result.leads.length > 0 && visible?.length === 0 && (
                <p>No matching inquiries.</p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
};
