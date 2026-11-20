const {test} = require('node:test');
const assert = require('node:assert/strict');
const quo = require('./desk-quo');

test('Primary, AniDeeBee, ToBa and Kiosk names map to those desks only', () => {
    assert.deepEqual(quo.companiesFor({name: 'Primary'}), ['AniDeeBee']);
    assert.deepEqual(quo.companiesFor({name: 'AniDeeBee/ToBa New'}), ['AniDeeBee', 'ToBa Tech']);
    assert.deepEqual(quo.companiesFor({name: 'AniDeeBee LLC --> Truck, Turo, Kiosk X (Google voice)'}), ['AniDeeBee', 'Kiosk X']);
    assert.deepEqual(quo.companiesFor({name: 'QuizVerse support'}), []);
});

test('A missing key does not call Quo', async () => {
    let called = false;
    const result = await quo.list('AniDeeBee', {readKey: () => '', request: () => { called = true; }});
    assert.equal(called, false);
    assert.equal(result.connected, false);
    assert.equal(result.message, 'Quo key is not stored yet.');
});

test('The desk list keeps our lines and drops the other person number', async () => {
    const secret = 'test-key-not-real';
    const seen = [];
    const request = async url => {
        seen.push(url);
        if (url.includes('/phone-numbers')) return {ok: true, json: async () => ({data: [
            {id: 'PNprimary', name: 'Primary', phoneNumber: '+12183953227'},
            {id: 'PNkiosk', name: 'AniDeeBee LLC --> Truck, Turo, Kiosk X (Google voice)', phoneNumber: '+15122656257'},
            {id: 'PNtoba', name: 'AniDeeBee/ToBa New', phoneNumber: '+16087194145'},
        ]})};
        return {ok: true, json: async () => ({data: [
            {id: 'AC1', phoneNumberId: 'PNkiosk', direction: 'incoming', status: 'missed', createdAt: '2026-11-19T23:27:11.185Z', duration: 0, participants: [{phoneNumber: '+19995550100'}]},
            {id: 'AC2', phoneNumberId: 'PNtoba', direction: 'outgoing', status: 'completed', createdAt: '2026-11-19T23:28:11.185Z', duration: 61, participants: [{phoneNumber: '+19995550199'}]},
        ]})};
    };
    const result = await quo.list('Kiosk X', {readKey: () => secret, request});
    assert.equal(result.connected, true);
    assert.deepEqual(result.lines.map(line => line.number), ['+15122656257']);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].status, 'missed');
    assert.equal(JSON.stringify(result).includes('+19995550100'), false);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(seen.some(url => url.startsWith('https://api.quo.com/phone-numbers')), true);
    const quiz = await quo.list('QuizVerse', {readKey: () => secret, request});
    assert.equal(quiz.message, 'Quo has no number for this company.');
    assert.deepEqual(quiz.lines, []);
});
