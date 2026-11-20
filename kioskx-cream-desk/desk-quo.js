const fs = require('node:fs');
const VERSION = '2026-03-30';

function readKey(read = fs.readFileSync) {
    const file = process.env.DESK_QUO_KEY_FILE || '/var/run/desk-quo/QUO_API_KEY';
    try { return String(read(file, 'utf8')).trim(); } catch { return ''; }
}

function companiesFor(line) {
    const name = String(line?.name || '');
    const companies = new Set();
    if (/anideebee/i.test(name) || /^primary$/i.test(name)) companies.add('AniDeeBee');
    if (/toba/i.test(name)) companies.add('ToBa Tech');
    if (/kiosk/i.test(name)) companies.add('Kiosk X');
    return [...companies];
}

async function list(company, deps = {}) {
    const token = (deps.readKey || readKey)();
    if (!token) return { connected: false, lines: [], calls: [], message: 'Quo key is not stored yet.' };
    const request = deps.request || fetch;
    const headers = { Authorization: token, 'Quo-Api-Version': VERSION };
    try {
        const numbers = await request('https://api.quo.com/phone-numbers', { headers, signal: AbortSignal.timeout(15000) });
        if (!numbers.ok) return { connected: false, lines: [], calls: [], message: 'Quo could not be reached.' };
        const listed = (await numbers.json()).data || [];
        const lines = listed.map(line => ({
            id: line.id,
            name: line.name || 'Quo number',
            number: line.phoneNumber || line.number || '',
            companies: companiesFor(line),
        })).filter(line => line.companies.includes(company));
        if (!lines.length) return { connected: true, lines: [], calls: [], message: 'Quo has no number for this company.' };
        const callsResponse = await request('https://api.quo.com/calls?maxResults=30', { headers, signal: AbortSignal.timeout(15000) });
        const rows = callsResponse.ok ? ((await callsResponse.json()).data || []) : [];
        const ids = new Set(lines.map(line => line.id));
        const calls = rows.filter(call => ids.has(call.phoneNumberId)).slice(0, 12).map(call => ({
            id: call.id,
            lineId: call.phoneNumberId,
            direction: call.direction,
            status: call.status,
            at: call.createdAt,
            duration: call.duration,
        }));
        return {
            connected: true,
            lines: lines.map(({ id, name, number }) => ({ id, name, number })),
            calls,
            message: 'Nothing is sent from this list.',
        };
    } catch {
        return { connected: false, lines: [], calls: [], message: 'Quo could not be reached.' };
    }
}

module.exports = { list, companiesFor, readKey };
