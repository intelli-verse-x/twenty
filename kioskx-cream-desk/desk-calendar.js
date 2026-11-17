// Calendar credentials never leave the server. Only the mapped company can use them.
// Writes use the existing calendar token. They do not grant the mailbox any new Google access.
const OWNER = 'support@anideebee.com';
const DISABLED = `Google Calendar API is turned off for ${OWNER}.`;
const ZONE = 'America/Chicago';
let cached;
async function access(request, env, force) {
  const key = [env.DESK_CALENDAR_CLIENT_ID, env.DESK_CALENDAR_REFRESH_TOKEN].join(':');
  if (!force && cached?.key === key && cached.until > Date.now()) return cached.token;
  const response = await request('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({client_id: env.DESK_CALENDAR_CLIENT_ID, client_secret: env.DESK_CALENDAR_CLIENT_SECRET, refresh_token: env.DESK_CALENDAR_REFRESH_TOKEN, grant_type: 'refresh_token'}),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw Error('Refresh unavailable');
  cached = {key, token: data.access_token, until: Date.now() + Math.max(0, Number(data.expires_in || 0) - 120) * 1000};
  return cached.token;
}
function ready(input, env) {
  return input.company === 'AniDeeBee' && env.DESK_CALENDAR_ID === OWNER && !!env.DESK_CALENDAR_REFRESH_TOKEN;
}
async function google(request, env, url, options = {}) {
  const token = await access(request, env, options.force);
  let response = await request(url, {method: options.method, headers: {Authorization: 'Bearer ' + token, ...(options.body ? {'Content-Type': 'application/json'} : {})}, body: options.body, signal: AbortSignal.timeout(10000)});
  if (response.status === 401 && !options.force) {
    cached = null;
    return google(request, env, url, {...options, force: true});
  }
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  return {response, data};
}
function eventOf(row) {
  return {id: row.id, title: row.summary || 'Appointment', start: row.start?.dateTime || row.start?.date, end: row.end?.dateTime || row.end?.date, allDay: !!row.start?.date};
}
async function list(input = {}, {request = fetch, env = process.env} = {}) {
  if (!ready(input, env)) return {connected: false, events: []};
  const unavailable = {connected: true, unavailable: true, events: [], message: 'Calendar is temporarily unavailable. Please try again.'};
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.month || '')) return {...unavailable, message: 'Choose a valid calendar month.'};
  try {
    const [year, month] = input.month.split('-').map(Number);
    // Include boundary days in every time zone; the month view filters locally.
    const query = new URLSearchParams({timeMin: new Date(Date.UTC(year, month - 1, 0)).toISOString(), timeMax: new Date(Date.UTC(year, month, 2)).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500'});
    const events = [];
    let timeZone;
    for (let page = 0; page < 20; page++) {
      const {response, data} = await google(request, env, 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(OWNER) + '/events?' + query);
      if (!response.ok) {
        const reasons = [...(data.error?.errors || []), ...(data.error?.details || [])].map(e => e.reason);
        if (reasons.includes('SERVICE_DISABLED') || reasons.includes('accessNotConfigured')) return {...unavailable, code: 'SERVICE_DISABLED', message: DISABLED};
        return unavailable;
      }
      timeZone = data.timeZone;
      for (const row of data.items || []) if (row.status !== 'cancelled') events.push(eventOf(row));
      if (!data.nextPageToken) return {connected: true, calendar: OWNER, timeZone, events};
      query.set('pageToken', data.nextPageToken);
    }
    return unavailable;
  } catch { return unavailable; }
}
function rejected(message) {
  return {connected: true, unavailable: true, events: [], message};
}
async function change(input = {}, {request = fetch, env = process.env} = {}) {
  if (!ready(input, env)) return {connected: false, events: []};
  const action = input.action;
  if (!['create', 'update', 'delete'].includes(action)) return rejected('Choose add, save, or delete.');
  const id = String(input.id || '');
  if (action !== 'create' && !/^[A-Za-z0-9_-]{5,1024}$/.test(id)) return rejected('Choose an event on the calendar.');
  const base = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(OWNER) + '/events';
  let url = base + '?sendUpdates=none';
  let method = 'POST';
  let payload;
  if (action === 'delete') {
    url = base + '/' + encodeURIComponent(id) + '?sendUpdates=none';
    method = 'DELETE';
  } else {
    const title = String(input.title || '').trim();
    const start = new Date(input.start);
    const end = new Date(input.end);
    const duration = end - start;
    if (!title || title.length > 140 || Number.isNaN(start.getTime()) || !(end > start) || duration > 14 * 86400000) return rejected('Add a title, a start, and a later end.');
    payload = JSON.stringify({summary: title, start: {dateTime: start.toISOString(), timeZone: ZONE}, end: {dateTime: end.toISOString(), timeZone: ZONE}});
    if (action === 'update') {
      url = base + '/' + encodeURIComponent(id) + '?sendUpdates=none';
      method = 'PATCH';
    }
  }
  try {
    const {response, data} = await google(request, env, url, {method, body: payload});
    if (!response.ok) return rejected('The event was not saved. Try again.');
    return {connected: true, saved: true, event: action === 'delete' ? {id} : eventOf(data)};
  } catch { return rejected('The event was not saved. Try again.'); }
}
module.exports = {list, change, DISABLED};
