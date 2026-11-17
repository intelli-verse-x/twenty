// Calendar credentials never leave the server. Only the mapped company can use them.
const OWNER = 'support@anideebee.com';
const DISABLED = `Google Calendar API is turned off for ${OWNER}.`;
let cached;
async function access(request, env) {
  const key = [env.DESK_CALENDAR_CLIENT_ID, env.DESK_CALENDAR_REFRESH_TOKEN].join(':');
  if (cached?.key === key && cached.until > Date.now()) return cached.token;
  const response = await request('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({client_id: env.DESK_CALENDAR_CLIENT_ID, client_secret: env.DESK_CALENDAR_CLIENT_SECRET, refresh_token: env.DESK_CALENDAR_REFRESH_TOKEN, grant_type: 'refresh_token'}),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw Error('Refresh unavailable');
  cached = {key, token: data.access_token, until: Date.now() + Math.max(0, Number(data.expires_in || 0) - 120) * 1000};
  return cached.token;
}
async function list(input = {}, {request = fetch, env = process.env} = {}) {
  if (input.company !== 'AniDeeBee' || env.DESK_CALENDAR_ID !== OWNER || !env.DESK_CALENDAR_REFRESH_TOKEN) return {connected: false, events: []};
  const unavailable = {connected: true, unavailable: true, events: [], message: 'Calendar is temporarily unavailable. Please try again.'};
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.month || '')) return {...unavailable, message: 'Choose a valid calendar month.'};
  try {
    const token = await access(request, env);
    const [year, month] = input.month.split('-').map(Number);
    // Include boundary days in every time zone; the month view filters locally.
    const query = new URLSearchParams({timeMin: new Date(Date.UTC(year, month - 1, 0)).toISOString(), timeMax: new Date(Date.UTC(year, month, 2)).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500'});
    const events = [];
    let timeZone;
    for (let page = 0; page < 20; page++) {
      const response = await request('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(OWNER) + '/events?' + query, {headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(10000)});
      const data = await response.json();
      if (!response.ok) {
        const reasons = [...(data.error?.errors || []), ...(data.error?.details || [])].map(e => e.reason);
        if (reasons.includes('SERVICE_DISABLED') || reasons.includes('accessNotConfigured')) return {...unavailable, code: 'SERVICE_DISABLED', message: DISABLED};
        return unavailable;
      }
      timeZone = data.timeZone;
      for (const row of data.items || []) if (row.status !== 'cancelled') events.push({id: row.id, title: row.summary || 'Appointment', start: row.start?.dateTime || row.start?.date, end: row.end?.dateTime || row.end?.date, allDay: !!row.start?.date});
      if (!data.nextPageToken) return {connected: true, calendar: OWNER, timeZone, events};
      query.set('pageToken', data.nextPageToken);
    }
    return unavailable;
  } catch { return unavailable; }
}
module.exports = {list, DISABLED};
