import { HiredDeskService, type HiredGoogleVoice } from './hired-desk.service';
import { hiredRequestAllowed, HIRED_WORKSPACE } from './hired-policy';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

jest.mock(
  'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager',
  () => ({ GlobalWorkspaceOrmManager: class {} }),
);
jest.mock('src/engine/twenty-orm/utils/build-system-auth-context.util', () => ({
  buildSystemAuthContext: (id: string) => ({ workspaceId: id }),
}));
jest.mock(
  'src/modules/person/standard-objects/person.workspace-entity',
  () => ({ PersonWorkspaceEntity: class Person {} }),
);
jest.mock('src/modules/note/standard-objects/note.workspace-entity', () => ({
  NoteWorkspaceEntity: class Note {},
}));
jest.mock(
  'src/modules/note/standard-objects/note-target.workspace-entity',
  () => ({ NoteTargetWorkspaceEntity: class NoteTarget {} }),
);
const id = '11111111-1111-4111-a111-111111111111';
const phone = '2025550123';
const email = 'lead@example.test';
const identity = {
  user: { email: 'support@kiosk-x.ai' },
  workspace: { id: HIRED_WORKSPACE },
};
const setup = (
  voice?: HiredGoogleVoice,
  mail?: import('./hired-mail').HiredMail,
) => {
  const person = {
    id,
    phones: { primaryPhoneNumber: phone, primaryPhoneCallingCode: '1' },
    emails: { primaryEmail: email },
  };
  const claims = new Set<string>();
  const notes = {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => [
      {
        id: 'form',
        title: 'KioskX contact form',
        bodyV2: { markdown: `I want a cabinet. Reach ${email} at ${phone}.` },
      },
    ]),
    insert: jest.fn(async (record) => {
      if (claims.has(record.id)) throw new Error('duplicate');
      claims.add(record.id);
    }),
    update: jest.fn(),
  };
  const targets = {
    find: jest.fn(async () => [{ noteId: 'form', targetPersonId: id }]),
    insert: jest.fn(),
  };
  const nonFormPerson = {
    ...person,
    id: '22222222-2222-4222-a222-222222222222',
    name: { firstName: 'Non-form person' },
  };
  const people = {
    find: jest.fn(async (options) =>
      [person, nonFormPerson].filter((row) =>
        options.where.id.value.includes(row.id),
      ),
    ),
  };
  const orm = {
    executeInWorkspaceContext: jest.fn(async (fn) => fn()),
    getRepository: jest.fn(async (_workspace, entity) => {
      const key = typeof entity === 'string' ? entity : entity.name;
      return {
        note: notes,
        noteTarget: targets,
        person: people,
        Note: notes,
        NoteTarget: targets,
        Person: people,
      }[key];
    }),
  };
  return {
    service: new HiredDeskService(
      orm as unknown as GlobalWorkspaceOrmManager,
      voice,
      mail,
    ),
    person,
    notes,
    people,
    targets,
  };
};
afterEach(() => {
  delete process.env.KIOSKX_HIRED_VOICE;
  delete process.env.KIOSKX_GOOGLE_VOICE_NUMBER;
  delete process.env.KIOSKX_HIRED_EMAIL;
});
it.each([undefined, 'false', 'TRUE', '1'])(
  'returns only safe contact-form inquiries with voice=%s',
  async (value) => {
    if (value) process.env.KIOSKX_HIRED_VOICE = value;
    const { service, people, notes } = setup();
    const result = await service.leads();
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0].label).toMatch(/^Inquiry /);
    expect(result.leads[0].inquiry).toContain('I want a cabinet');
    expect(result.leads[0].email).toBe('••••@••••');
    expect(result.leads[0].phone).toBe('••• ••• ••••');
    expect(result.leads[0].inquiry).not.toContain(email);
    expect(result.leads[0].inquiry).not.toContain(phone);
    expect(result.leads[0].canCall).toBe(false);
    for (const forbidden of ['mailto:', 'tel:', 'Non-form person'])
      expect(JSON.stringify(result)).not.toContain(forbidden);
    expect(notes.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          title: expect.objectContaining({
            _value: ['KioskX contact form', 'KioskX newsletter'],
          }),
        },
      }),
    );
    expect(people.find).toHaveBeenCalledWith({
      where: { id: expect.objectContaining({ _value: [id] }) },
    });
  },
);
it('does not load non-form People', async () => {
  const { service, notes, people } = setup();
  notes.find.mockResolvedValue([]);
  expect((await service.leads()).leads).toEqual([]);
  expect(people.find).not.toHaveBeenCalled();
});
it('fails closed on query errors', async () => {
  const { service, notes } = setup();
  notes.find.mockRejectedValue(new Error(email));
  expect(await service.leads()).toEqual({ unavailable: true, leads: [] });
});
it('requires an office number and a valid destination', async () => {
  expect((await setup().service.leads()).leads[0].canCall).toBe(false);
  process.env.KIOSKX_GOOGLE_VOICE_NUMBER = '+12025550100';
  const { service, person } = setup();
  expect((await service.leads()).leads[0].canCall).toBe(true);
  person.phones.primaryPhoneNumber = '';
  expect((await service.leads()).leads[0].canCall).toBe(false);
});
it('returns Connect without invoking a legacy dialer or creating a call claim', async () => {
  process.env.KIOSKX_GOOGLE_VOICE_NUMBER = '+12025550100';
  const voice = { configured: () => true, conversation: jest.fn() };
  const { service, notes } = setup(voice);
  expect(await service.call(id, id)).toEqual({ status: 'connect' });
  expect(voice.conversation).not.toHaveBeenCalled();
  expect(notes.insert).not.toHaveBeenCalled();
});
it('keeps an explicit operator disable and never calls a legacy dialer', async () => {
  process.env.KIOSKX_HIRED_VOICE = 'false';
  process.env.KIOSKX_GOOGLE_VOICE_NUMBER = '+12025550100';
  const voice = { configured: () => true, conversation: jest.fn() };
  const { service } = setup(voice);
  expect(await service.call(id, id)).toEqual({ status: 'unavailable' });
  expect(voice.conversation).not.toHaveBeenCalled();
});
it.each([
  '/graphql',
  '/metadata',
  '/admin-panel',
  '/rest/people',
  '/rest/companies',
  '/rest/opportunities',
  '/rest/notes',
  '/rest/workflows',
  '/mcp',
  '/kioskx-hired-desk/leads/../people',
])('blocks hired direct API %s but preserves admin', (url) => {
  expect(hiredRequestAllowed(identity, { method: 'POST', url })).toBe(false);
  expect(
    hiredRequestAllowed(
      { ...identity, user: { email: 'admin@example.test' } },
      { method: 'POST', url },
    ),
  ).toBe(true);
});
it('allows only desk endpoint methods and keeps other workspaces unchanged', () => {
  expect(
    hiredRequestAllowed(identity, {
      method: 'GET',
      url: '/kioskx-hired-desk/leads',
    }),
  ).toBe(true);
  expect(
    hiredRequestAllowed(identity, {
      method: 'POST',
      url: '/kioskx-hired-desk/leads',
    }),
  ).toBe(false);
  expect(
    hiredRequestAllowed(
      { ...identity, workspace: { id: 'other' } },
      { method: 'GET', url: '/rest/people' },
    ),
  ).toBe(true);
});

it.each([
  ['GET', 'session'],
  ['GET', 'leads'],
  ['POST', 'call'],
  ['POST', 'email'],
])('accepts full originalUrl for %s %s', (method, endpoint) => {
  expect(
    hiredRequestAllowed(identity, {
      method,
      originalUrl: `https://kioskx.crm.intelli-verse-x.ai/kioskx-hired-desk/${endpoint}?test=1`,
    }),
  ).toBe(true);
});
it('blocks non-desk full URLs and malformed URLs', () => {
  for (const originalUrl of [
    'https://kioskx.crm.intelli-verse-x.ai/rest/people',
    'http://[invalid',
  ]) {
    expect(hiredRequestAllowed(identity, { method: 'GET', originalUrl })).toBe(
      false,
    );
  }
});

it.each(['KioskX contact form', 'KioskX newsletter'])(
  'extracts labeled contacts from %s when person fields are empty',
  async (title) => {
    const { service, person, notes } = setup();
    person.emails.primaryEmail = '';
    person.phones.primaryPhoneNumber = '';
    notes.find.mockResolvedValue([
      {
        id: 'form',
        title,
        bodyV2: {
          markdown:
            '|Email: note@example.test|Phone: +1 (202) 555-0145|City / State: Austin, TX|',
        },
      },
    ]);
    expect((await service.leads()).leads[0]).toMatchObject({
      email: '••••@••••',
      phone: '••• ••• ••••',
      canCall: false,
    });
  },
);
it('returns empty first-class fields when both sources lack contacts', async () => {
  const { service, person, notes } = setup();
  person.emails.primaryEmail = '';
  person.phones.primaryPhoneNumber = '';
  notes.find.mockResolvedValue([
    {
      id: 'form',
      title: 'KioskX newsletter',
      bodyV2: { markdown: 'Newsletter signup' },
    },
  ]);
  expect((await service.leads()).leads[0]).toMatchObject({
    email: '',
    phone: '',
    canCall: false,
  });
});

it('does not offer calling when the line is missing even with an adapter', async () => {
  process.env.KIOSKX_HIRED_VOICE = 'true';
  const voice = { configured: () => true, conversation: jest.fn() };
  const { service } = setup(voice);
  expect((await service.leads()).leads[0].canCall).toBe(false);
  expect(await service.call(id, id)).toEqual({ status: 'unavailable' });
  expect(voice.conversation).not.toHaveBeenCalled();
});
it('does not claim a transcript was saved when completed call text is empty', async () => {
  process.env.KIOSKX_HIRED_VOICE = 'true';
  process.env.KIOSKX_GOOGLE_VOICE_NUMBER = 'test-line';
  const { service, notes } = setup({
    configured: () => true,
    conversation: async () => ({ transcript: ' ' }),
  });
  expect(await service.call(id, id)).toEqual({ status: 'connect' });
  expect(notes.update).not.toHaveBeenCalled();
});
it('sends from server-resolved recipient once and stores the sent body for admins', async () => {
  process.env.KIOSKX_HIRED_EMAIL = 'true';
  const mail = { configured: () => true, send: jest.fn(async () => {}) };
  const { service, notes, targets } = setup(undefined, mail);
  const result = await service.email(id, id, 'Hello');
  expect(result.status).toBe('sent');
  expect(mail.send).toHaveBeenCalledWith({
    destination: email,
    body: 'Hello',
    operationId: expect.any(String),
  });
  expect(notes.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'KioskX hired email pending',
      bodyV2: expect.objectContaining({
        markdown: 'Hello',
        blocknote: expect.any(String),
      }),
    }),
  );
  expect(targets.insert).toHaveBeenCalled();
  expect(notes.update).toHaveBeenCalledWith(expect.any(String), {
    title: 'KioskX hired email',
  });
  expect(await service.email(id, id, 'Hello')).toEqual({
    status: 'alreadySubmitted',
  });
  expect(mail.send).toHaveBeenCalledTimes(1);
});
it('does not send mail when off or to a non-form lead', async () => {
  const mail = { configured: () => true, send: jest.fn() };
  const { service } = setup(undefined, mail);
  expect(await service.email(id, id, 'Hello')).toEqual({
    status: 'unavailable',
  });
  process.env.KIOSKX_HIRED_EMAIL = 'true';
  expect(await service.email('not-a-lead', id, 'Hello')).toEqual({
    status: 'unavailable',
  });
  expect(mail.send).not.toHaveBeenCalled();
});
it('retains an ambiguous mail claim and never replays or leaks the error', async () => {
  process.env.KIOSKX_HIRED_EMAIL = 'true';
  const mail = {
    configured: () => true,
    send: jest.fn(async () => {
      throw new Error(email);
    }),
  };
  const { service, notes } = setup(undefined, mail);
  expect(await service.email(id, id, 'Hello')).toEqual({ status: 'unknown' });
  expect(await service.email(id, id, 'Hello')).toEqual({
    status: 'alreadySubmitted',
  });
  expect(mail.send).toHaveBeenCalledTimes(1);
  expect(notes.update).not.toHaveBeenCalled();
});
it('uses name and company from the form, never leaking contacts in labels', async () => {
  const { service, notes } = setup();
  notes.find.mockResolvedValue([
    {
      id: 'form',
      title: 'KioskX contact form',
      bodyV2: {
        markdown:
          '|Name: Alex|Company: Example Retail|Message: A cabinet please|',
      },
    },
  ]);
  expect((await service.leads()).leads[0]).toMatchObject({
    label: 'Alex',
    company: 'Example Retail',
  });
});

it('reloads only sent emails on the matching inquiry and redacts extra addresses', async () => {
  const { service, notes, targets } = setup();
  notes.find.mockImplementation(async (options: any) =>
    typeof options.where.title === 'string'
      ? ([
          {
            id: 'sent',
            title: 'KioskX hired email',
            createdAt: new Date('2026-10-29T10:00:00Z'),
            bodyV2: { markdown: 'Hello. Other person: other@example.test' },
          },
        ] as any)
      : [
          {
            id: 'form',
            title: 'KioskX contact form',
            bodyV2: { markdown: 'Need a cabinet' },
          },
        ],
  );
  targets.find.mockResolvedValue([
    { noteId: 'form', targetPersonId: id },
    { noteId: 'sent', targetPersonId: id },
  ]);
  const lead = (await service.leads()).leads[0];
  expect(lead.messages).toHaveLength(1);
  expect(lead.messages[0].body).toContain('Hello.');
  expect(JSON.stringify(lead)).not.toContain('other@example.test');
});
