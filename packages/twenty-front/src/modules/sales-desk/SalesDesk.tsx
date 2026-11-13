import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'twenty-ui/input';
import { Card } from 'twenty-ui/surfaces';
import './SalesDesk.css';

export const queues = ['Cleaning', 'Cars', 'Jobs', 'Turo'] as const;
export type SalesRow = {
  id: string;
  label: string;
  company: string;
  inquiry: string;
  email?: string;
  phone?: string;
  active?: boolean;
  nextStep?: string;
  dueAt?: string;
  hiringStatus?: 'new' | 'reviewing' | 'contacted';
};
export type Channels = { email: boolean; voice: boolean; voiceStatus: string };
export type SalesResponse = {
  allowed?: boolean;
  channels?: Channels;
  rows?: SalesRow[];
  row?: SalesRow;
  empty?: string;
  unavailable?: boolean;
  status?: string;
};
export type SalesRequest = (
  path: string,
  body?: unknown,
) => Promise<SalesResponse>;

const InquiryCard = ({
  row,
  queue,
  request,
  channels,
  onSave,
}: {
  row: SalesRow;
  queue: string;
  request: SalesRequest;
  channels: Channels;
  onSave: (row: SalesRow) => void;
}) => {
  const [nextStep, setNextStep] = useState(row.nextStep ?? '');
  const [dueAt, setDueAt] = useState(row.dueAt ? localDate(row.dueAt) : '');
  const [hiringStatus, setHiringStatus] = useState(row.hiringStatus ?? 'new');
  const [status, setStatus] = useState('');
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [sending, setSending] = useState(false);
  const claim = useRef<string | undefined>(undefined);
  const saving = useRef(false);
  const callClaim = useRef<string | undefined>(undefined);
  const report = queue === 'turo';
  const followUp =
    (queue === 'cleaning' || queue === 'cars') && row.active !== false;
  const path = `queues/${queue}/${encodeURIComponent(row.id)}`;
  const save = async () => {
    if (saving.current) return;
    if (followUp && (!nextStep.trim() || !dueAt)) {
      setStatus(
        `${[!nextStep.trim() && 'Next step', !dueAt && 'Due time'].filter(Boolean).join(' and ')} required.`,
      );
      return;
    }
    saving.current = true;
    try {
      const result = await request(
        `${path}/save`,
        queue === 'jobs'
          ? { hiringStatus }
          : { nextStep, dueAt: new Date(dueAt).toISOString() },
      );
      if (!result.row) throw new Error('No saved card');
      onSave(result.row);
      setStatus('Saved.');
    } catch {
      setStatus('Could not save. Your request stays in this queue.');
    } finally {
      saving.current = false;
    }
  };
  const call = async () => {
    if (!channels.voice || callClaim.current) return;
    callClaim.current = crypto.randomUUID();
    setCallStatus('Calling…');
    try {
      const result = await request(`${path}/call`, {
        requestId: callClaim.current,
      });
      setCallStatus(
        result.status === 'unavailable'
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
    if (!channels.email) {
      setEmailStatus('Email is unavailable.');
      return;
    }
    if (claim.current || !body.trim()) return;
    claim.current = crypto.randomUUID();
    setSending(true);
    try {
      const result = await request(`${path}/email`, {
        requestId: claim.current,
        body,
      });
      if (result.status === 'sent') {
        setEmailStatus('Email sent');
        setComposing(false);
        setBody('');
        claim.current = undefined;
      } else if (result.status === 'unavailable') {
        setEmailStatus('Email is unavailable.');
        claim.current = undefined;
      } else
        setEmailStatus(
          'Email status is unavailable. Contact your admin before trying again.',
        );
    } catch {
      setEmailStatus(
        'Email status is unavailable. Contact your admin before trying again.',
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <article aria-label={row.label}>
      <Card className="hired-card" rounded fullWidth>
        <div className="hired-card-heading">
          <div className="hired-avatar" aria-hidden="true">
            {row.label.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2>{row.label}</h2>
            {row.company && <p className="hired-muted">{row.company}</p>}
          </div>
          <span className="hired-source">{report ? 'Report' : 'Inquiry'}</span>
        </div>
        <div className="hired-card-main">
          <dl className="hired-fields">
            {!report && (
              <>
                <dt>Email</dt>
                <dd>{row.email || 'No email'}</dd>
                <dt>Phone</dt>
                <dd>{row.phone || 'No phone'}</dd>
              </>
            )}
            {row.inquiry
              .split(/\r?\n|\|/)
              .filter(Boolean)
              .map((line, index) => {
                const colon = line.indexOf(':');
                return (
                  <div className="hired-field" key={index}>
                    <dt>
                      {colon > 0 && colon < 45
                        ? line.slice(0, colon)
                        : 'Inquiry'}
                    </dt>
                    <dd>
                      {colon > 0 && colon < 45
                        ? line.slice(colon + 1).trim()
                        : line}
                    </dd>
                  </div>
                );
              })}
            {followUp && (
              <>
                <dt>Next step</dt>
                <dd>{row.nextStep || 'Not set'}</dd>
                <dt>Due time</dt>
                <dd>
                  {row.dueAt ? (
                    <time dateTime={row.dueAt}>
                      {new Date(row.dueAt).toLocaleString()}
                    </time>
                  ) : (
                    'Not set'
                  )}
                </dd>
              </>
            )}
            {queue === 'jobs' && (
              <>
                <dt>Hiring status</dt>
                <dd>{row.hiringStatus ?? 'new'}</dd>
              </>
            )}
          </dl>
          {queue === 'cars' && <p>This request does not reserve a car.</p>}
          {(followUp || queue === 'jobs') && (
            <form
              className="sales-follow-up"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {followUp ? (
                <>
                  <label htmlFor={`next-${row.id}`}>Next step</label>
                  <input
                    id={`next-${row.id}`}
                    value={nextStep}
                    maxLength={2000}
                    onChange={(event) => setNextStep(event.target.value)}
                  />
                  <label htmlFor={`due-${row.id}`}>Due time</label>
                  <input
                    id={`due-${row.id}`}
                    type="datetime-local"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                  />
                </>
              ) : (
                <>
                  <label htmlFor={`status-${row.id}`}>Hiring status</label>
                  <select
                    id={`status-${row.id}`}
                    value={hiringStatus}
                    onChange={(event) =>
                      setHiringStatus(
                        event.target.value as SalesRow['hiringStatus'] & string,
                      )
                    }
                  >
                    {['new', 'reviewing', 'contacted'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </>
              )}
              <Button
                title="Save"
                ariaLabel="Save"
                type="submit"
                variant="secondary"
              />
            </form>
          )}
          {status && <p role="status">{status}</p>}
          {!report && (
            <>
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
                  disabled={!channels.voice || !!callStatus}
                  onClick={() => void call()}
                />
              </div>
              {!channels.email && (
                <p role="status" className="hired-muted">
                  Email is unavailable.
                </p>
              )}
              {!channels.voice && (
                <p role="status" className="hired-muted">
                  {channels.voiceStatus}
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
                  <p>To: {row.label}</p>
                  <label htmlFor={`email-${row.id}`}>Message</label>
                  <textarea
                    id={`email-${row.id}`}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={10000}
                    rows={5}
                    required
                    autoFocus
                    disabled={sending || !!claim.current}
                  />
                  <div className="hired-actions">
                    <Button
                      title={sending ? 'Sending…' : 'Send'}
                      ariaLabel={sending ? 'Sending…' : 'Send'}
                      type="submit"
                      variant="primary"
                      accent="blue"
                      disabled={!body.trim() || sending || !!claim.current}
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
            </>
          )}
        </div>
      </Card>
    </article>
  );
};
function localDate(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
const Queue = ({
  name,
  request,
  channels,
}: {
  name: (typeof queues)[number];
  request: SalesRequest;
  channels: Channels;
}) => {
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [empty, setEmpty] = useState('');
  const [status, setStatus] = useState('Loading…');
  const [refresh, setRefresh] = useState(0);
  const queue = name.toLowerCase();
  useEffect(() => {
    let active = true;
    request(`queues/${queue}`)
      .then((result) => {
        if (result.unavailable || !Array.isArray(result.rows))
          throw new Error('Unavailable');
        if (active) {
          setRows(result.rows);
          setEmpty(result.empty ?? 'No requests in this queue.');
          setStatus('');
        }
      })
      .catch(() => {
        if (active) setStatus(`${name} could not refresh. Try again.`);
      });
    return () => {
      active = false;
    };
  }, [request, queue, name, refresh]);
  const onSave = useCallback(
    (row: SalesRow) =>
      setRows((previous) =>
        previous.map((item) => (item.id === row.id ? row : item)),
      ),
    [],
  );
  return (
    <section aria-label={name} className="sales-queue">
      <div className="hired-list-toolbar">
        <h2>{name}</h2>
        <Button
          title="Refresh"
          ariaLabel={`Refresh ${name}`}
          variant="secondary"
          onClick={() => setRefresh((value) => value + 1)}
        />
      </div>
      {status && <p role="status">{status}</p>}
      {!rows.length && status !== 'Loading…' && (
        <p>{empty || 'No requests have loaded for this queue.'}</p>
      )}
      {rows.map((row) => (
        <InquiryCard
          key={row.id}
          row={row}
          queue={queue}
          request={request}
          channels={channels}
          onSave={onSave}
        />
      ))}
    </section>
  );
};
export const SalesDesk = ({
  request,
  channels,
  onSignOut,
}: {
  request: SalesRequest;
  channels: Channels;
  onSignOut: () => void;
}) => (
  <main className="hired-desk sales-desk">
    <aside className="hired-sidebar">
      <strong>Sales desk</strong>
      <span>IntelliVerse</span>
      <nav aria-label="Queues">
        {queues.map((name) => (
          <a className="hired-nav" key={name} href={`#sales-${name}`}>
            {name}
          </a>
        ))}
      </nav>
    </aside>
    <div className="hired-workspace">
      <header className="hired-toolbar">
        <h1>Inquiries</h1>
        <Button
          title="Sign out"
          ariaLabel="Sign out"
          variant="secondary"
          onClick={onSignOut}
        />
      </header>
      <div className="hired-content">
        {queues.map((name) => (
          <div id={`sales-${name}`} key={name}>
            <Queue name={name} request={request} channels={channels} />
          </div>
        ))}
      </div>
    </div>
  </main>
);
