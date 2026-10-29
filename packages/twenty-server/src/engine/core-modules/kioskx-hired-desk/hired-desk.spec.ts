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
const setup = (voice?: HiredGoogleVoice) => {
  const person = {
    id,
    phones: { primaryPhoneNumber: phone, primaryPhoneCallingCode: '1' },
    emails: { primaryEmail: email },
  };
  const claims = new Set<string>();
  const notes = {
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
    ),
    person,
    notes,
    people,
    targets,
  };
};
afterEach(() => {
  delete process.env.KIOSKX_HIRED_VOICE;
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
    expect(result.leads[0].canCall).toBe(false);
    for (const forbidden of [
      email,
      phone,
      'mailto:',
      'tel:',
      'Non-form person',
    ])
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
it('requires configured Google Voice and a destination even when enabled', async () => {
  process.env.KIOSKX_HIRED_VOICE = 'true';
  expect((await setup().service.leads()).leads[0].canCall).toBe(false);
  const { service, person } = setup({
    configured: () => true,
    conversation: jest.fn(),
  });
  person.phones.primaryPhoneNumber = '';
  expect((await service.leads()).leads[0].canCall).toBe(false);
});
it('uses only the injected fake Google Voice and stores the admin transcript once', async () => {
  process.env.KIOSKX_HIRED_VOICE = 'true';
  const voice = {
    configured: () => true,
    conversation: jest.fn(async () => ({
      transcript: 'Private admin transcript',
    })),
  };
  const { service, notes } = setup(voice);
  expect((await service.leads()).leads[0].canCall).toBe(true);
  expect(await service.call(id, id)).toEqual({ status: 'complete' });
  expect(await service.call(id, id)).toEqual({ status: 'alreadySubmitted' });
  expect(voice.conversation).toHaveBeenCalledTimes(1);
  expect(notes.update).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      bodyV2: expect.objectContaining({ markdown: 'Private admin transcript' }),
    }),
  );
  expect(JSON.stringify(await service.leads())).not.toContain(
    'Private admin transcript',
  );
});
it('does not replay ambiguous calls or echo transport errors', async () => {
  process.env.KIOSKX_HIRED_VOICE = 'true';
  const voice = {
    configured: () => true,
    conversation: jest.fn(async () => {
      throw new Error(phone);
    }),
  };
  const { service } = setup(voice);
  expect(await service.call(id, id)).toEqual({ status: 'unknown' });
  await service.call(id, id);
  expect(voice.conversation).toHaveBeenCalledTimes(1);
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
  ['GET', 'session'], ['GET', 'leads'], ['POST', 'call'],
])('accepts full originalUrl for %s %s', (method, endpoint) => {
  expect(hiredRequestAllowed(identity, {
    method, originalUrl: `https://kioskx.crm.intelli-verse-x.ai/kioskx-hired-desk/${endpoint}?test=1`,
  })).toBe(true);
});
it('blocks non-desk full URLs and malformed URLs', () => {
  for (const originalUrl of ['https://kioskx.crm.intelli-verse-x.ai/rest/people', 'http://[invalid']) {
    expect(hiredRequestAllowed(identity, { method: 'GET', originalUrl })).toBe(false);
  }
});
