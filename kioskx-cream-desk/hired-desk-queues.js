const { BadRequestException } = require('@nestjs/common');
const { Client } = require('pg');
const QUEUES = { cleaning: 'cleaning_request', cars: 'car_request', jobs: 'job_application' };
const STATUSES = ['New', 'Call next', 'Waiting', 'Done'];
const TURO = [
    ['turo:c300', 'Mercedes C300'], ['turo:tesla-2023', '2023 Tesla Model Y'],
    ['turo:gls450', 'Mercedes GLS450'], ['turo:tesla-2027', '2027 Tesla Model Y'],
];
const fleet = () => ({ rows: TURO.map(([id, label]) => ({ id, label, summary: 'Own reminder', status: 'New', note: '' })) });
const text = value => ['string', 'number'].includes(typeof value) ? String(value).replace(/[{}]/g, '').trim() : '';
function details(raw) {
    let value = raw;
    for (let n = 0; n < 4 && typeof value === 'string'; n++) {
        value = value.trim();
        if (!/^[{["\]]/.test(value)) return { message: value };
        try { value = JSON.parse(value); } catch { return {}; }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
const requestMessage = raw => {
    const value = details(raw).message;
    return typeof value === 'string' && !/^[{["\]]/.test(value.trim()) ? text(value) : '';
};
const isTestRecord = (record, message) =>
    /synthetic|not\s+a\s+candidate|not\s+a\s+real|please\s+discard|form\s+check|test\s+applicant/i.test(`${record.name || ''} ${message}`) ||
    /^TTTT$/i.test(text(record.name)) || /^(?:test\s*)+$/i.test(message.trim());
const sentence = parts => parts.filter(Boolean).map(s => s.replace(/[.\s]+$/, '') + '.').join(' ');
function row(record, queue) {
    const d = details(record.requestDetailsMarkdown), message = requestMessage(record.requestDetailsMarkdown);
    if (isTestRecord(record, message)) return null;
    const service = text(record.requestedService) || text(d.service);
    const val = key => text(d[key]);
    let description;
    if (queue === 'cleaning') description = sentence([
        service,
        [val('bedrooms') && `${val('bedrooms')} bedrooms`, val('bathrooms') && `${val('bathrooms')} bathrooms`, val('size'), val('zip') && `ZIP ${val('zip')}`].filter(Boolean).join(', '),
        [val('frequency'), val('date') && `date ${val('date')}`].filter(Boolean).join(', '),
        val('laundryNotes') && `Laundry: ${val('laundryNotes')}`,
    ]);
    else if (queue === 'cars') description = sentence([
        [val('vehicle') + (val('purpose') ? `${val('vehicle') ? ' for ' : ''}${val('purpose')}` : ''), val('location'), val('duration'), val('endDate') && `through ${val('endDate')}`].filter(Boolean).join(', '),
        val('company') && `Company: ${val('company')}`, val('equipment') && `Equipment: ${val('equipment')}`,
    ]);
    else description = sentence([service]);
    description = [description, message ? sentence([`They wrote: ${message}`]) : 'No message was submitted.'].filter(Boolean).join(' ');
    return { id: String(record.id), label: text(record.name || 'Inquiry').slice(0, 200), service,
        summary: service || (queue === 'cars' ? val('vehicle') : '') || 'Inquiry', description,
        email: text(record.email) || val('email'), phone: text(record.phone) || val('phone'),
        message, notice: queue === 'cars' ? 'This request does not reserve a car.' : '',
        status: 'New', draft: '', note: '' };
}
async function workspace(client) {
    const result = await client.query('SELECT "databaseSchema" FROM core.workspace WHERE subdomain = $1', ['ivx']);
    const schema = result.rows[0]?.databaseSchema;
    if (!/^workspace_[a-z0-9]+$/.test(schema || '')) throw new Error('Workspace unavailable');
    return schema;
}
const connect = () => new Client({ connectionString: process.env.PG_DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 8000 });
async function queueBoard() {
    const client = connect();
    try {
        await client.connect();
        const schema = await workspace(client);
        const found = await client.query(`SELECT id, name, kind, "requestedService", email, phone, "requestDetailsMarkdown"
            FROM ${schema}."_anideebeeInquiry" WHERE "deletedAt" IS NULL AND kind = ANY($1)
            ORDER BY "receivedAt" DESC NULLS LAST`, [Object.values(QUEUES)]);
        const queues = Object.fromEntries(Object.entries(QUEUES).map(([key, kind]) => [key, {
            rows: found.rows.filter(r => r.kind === kind).map(r => row(r, key)).filter(Boolean), empty: 'No requests in this queue.',
        }]));
        queues.turo = fleet();
        let workUnavailable = false;
        try {
            const work = await client.query(`SELECT inquiry_id, status, draft, note FROM ${schema}."_deskQueueWork"`);
            const byId = new Map(work.rows.map(r => [r.inquiry_id, r]));
            for (const queue of Object.values(queues)) for (const item of queue.rows) {
                const saved = byId.get(item.id);
                if (saved) Object.assign(item, { status: saved.status, draft: saved.draft, note: saved.note });
            }
        } catch { workUnavailable = true; }
        return { queues, workUnavailable, mailEnabled: false };
    } catch { return { unavailable: true, workUnavailable: true, queues: { turo: fleet() }, mailEnabled: false }; }
    finally { await client.end().catch(() => undefined); }
}
async function saveWork(input) {
    if (!input || typeof input !== 'object' || typeof input.id !== 'string' ||
        Object.keys(input).some(k => !['id','status','draft','note'].includes(k)) ||
        Object.keys(input).length < 2 ||
        (input.status !== undefined && !STATUSES.includes(input.status)) ||
        ['draft','note'].some(k => input[k] !== undefined && (typeof input[k] !== 'string' || input[k].length > 10000)))
        throw new BadRequestException('Invalid work update.');
    const isFleet = TURO.some(([id]) => id === input.id);
    if ((!isFleet && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.id)) ||
        (isFleet && (input.status !== undefined || input.draft !== undefined)) || (!isFleet && input.note !== undefined))
        throw new BadRequestException('Invalid work update.');
    const client = connect();
    try {
        await client.connect();
        const schema = await workspace(client);
        if (!isFleet) {
            const found = await client.query(`SELECT id, name, kind, "requestDetailsMarkdown" FROM ${schema}."_anideebeeInquiry"
                WHERE id = $1 AND "deletedAt" IS NULL AND kind = ANY($2)`, [input.id, Object.values(QUEUES)]);
            if (!found.rows.length || isTestRecord(found.rows[0], requestMessage(found.rows[0].requestDetailsMarkdown)))
                throw new BadRequestException('Request is unavailable.');
        }
        // Only supplied fields change: saving a draft cannot revert a newer status.
        const result = await client.query(`INSERT INTO ${schema}."_deskQueueWork" (inquiry_id,status,draft,note)
            VALUES ($1,COALESCE($2,'New'),COALESCE($3,''),COALESCE($4,''))
            ON CONFLICT (inquiry_id) DO UPDATE SET status=COALESCE($2,"_deskQueueWork".status),
            draft=COALESCE($3,"_deskQueueWork".draft),note=COALESCE($4,"_deskQueueWork".note),updated_at=now()
            RETURNING status,draft,note`, [input.id,input.status ?? null,input.draft ?? null,input.note ?? null]);
        return { saved: true, work: result.rows[0] };
    } catch (error) {
        if (error instanceof BadRequestException) throw error;
        return { saved: false, workUnavailable: true };
    } finally { await client.end().catch(() => undefined); }
}
async function guardedSend(send) {
    if (!process.env.DESK_QUEUE_MAIL) return { sent: false, message: 'Mailbox send is off.' };
    if (typeof send !== 'function') return { sent: false, message: 'Mailbox send is unavailable.' };
    return send();
}
class QueueController {
    async queues(request) { await this.authorize(request); return queueBoard(); }
    async queueWork(request, body) { await this.authorize(request); return saveWork(body); }
    async queueSend(request) { await this.authorize(request); return guardedSend(); }
}
exports.install = Controller => {
    const common = require('@nestjs/common');
    for (const [name, route, verb] of [['queues','queues','Get'],['queueWork','queue-work','Post'],['queueSend','queue-send','Post']]) {
        Object.defineProperty(Controller.prototype, name, Object.getOwnPropertyDescriptor(QueueController.prototype, name));
        const desc = Object.getOwnPropertyDescriptor(Controller.prototype, name);
        common[verb](route)(Controller.prototype, name, desc);
        common.Header('Cache-Control','no-store')(Controller.prototype, name, desc);
        common.Req()(Controller.prototype,name,0);
        if (verb === 'Post') common.Body()(Controller.prototype,name,1);
    }
};
exports.row = row;
exports.requestMessage = requestMessage;
exports.queueBoard = queueBoard;
exports.saveWork = saveWork;
exports.guardedSend = guardedSend;
