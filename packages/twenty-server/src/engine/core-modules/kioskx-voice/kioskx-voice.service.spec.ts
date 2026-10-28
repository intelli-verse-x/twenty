jest.mock('crypto', () => ({ randomUUID: () => 'fake-operation' }));
import { KioskxVoiceService } from './kioskx-voice.service';
import { KIOSKX_WORKSPACE_ID } from './kioskx-call';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { NoteWorkspaceEntity } from 'src/modules/note/standard-objects/note.workspace-entity';
jest.mock(
  'src/engine/core-modules/message-queue/decorators/message-queue.decorator',
  () => ({ InjectMessageQueue: () => () => undefined }),
);
jest.mock(
  'src/engine/core-modules/message-queue/message-queue.constants',
  () => ({ MessageQueue: { messagingQueue: 'messaging' } }),
);
jest.mock(
  'src/engine/core-modules/message-queue/services/message-queue.service',
  () => ({ MessageQueueService: class {} }),
);
jest.mock('src/engine/core-modules/redis-client/redis-client.service', () => ({
  RedisClientService: class {},
}));
jest.mock(
  'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager',
  () => ({ GlobalWorkspaceOrmManager: class {} }),
);
jest.mock('src/engine/twenty-orm/utils/build-system-auth-context.util', () => ({
  buildSystemAuthContext: (workspaceId: string) => ({
    type: 'system',
    workspace: { id: workspaceId },
  }),
}));
jest.mock(
  'src/modules/person/standard-objects/person.workspace-entity',
  () => ({ PersonWorkspaceEntity: class {} }),
);
jest.mock('src/modules/note/standard-objects/note.workspace-entity', () => ({
  NoteWorkspaceEntity: class {},
}));
jest.mock(
  'src/modules/note/standard-objects/note-target.workspace-entity',
  () => ({ NoteTargetWorkspaceEntity: class {} }),
);
jest.mock('libphonenumber-js', () => ({
  parsePhoneNumberFromString: (raw: string) => ({
    number: raw,
    isValid: () => true,
  }),
}));

const setup = () => {
  const values = new Map<string, string>();
  const redisClient = {
    get: jest.fn(async (key: string) => values.get(key) || null),
    set: jest.fn(async (key: string, value: string, nx?: string) => {
      if (nx === 'NX' && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }),
  };
  const person = {
    findOne: jest.fn(async () => ({
      phones: { primaryPhoneNumber: 'fake-saved-phone' },
    })),
  };
  const notes = {
    findOne: jest.fn(async () => null),
    insert: jest.fn(async () => undefined),
  };
  const targets = { insert: jest.fn(async () => undefined) };
  const orm = {
    executeInWorkspaceContext: jest.fn(async (fn: () => Promise<unknown>) =>
      fn(),
    ),
    getRepository: jest.fn(async (_workspace: string, entity: unknown) =>
      entity === PersonWorkspaceEntity
        ? person
        : entity === NoteWorkspaceEntity
          ? notes
          : targets,
    ),
    getGlobalWorkspaceDataSource: async () => ({
      transaction: async (fn: (manager: unknown) => Promise<void>) => fn({}),
    }),
  };
  const voice = {
    configured: () => true,
    create: jest.fn(async () => 'fake-call'),
    read: jest.fn(async () => ({
      ended: true,
      transcript: 'Real returned transcript',
    })),
  };
  const queue = { add: jest.fn(async () => undefined) };
  const service = new KioskxVoiceService(
    orm as never,
    { getClient: () => redisClient } as never,
    voice as never,
    queue as never,
  );
  return { service, person, notes, targets, queue, voice, values };
};

describe('person-call server integration with fake voice', () => {
  const original = process.env.KIOSKX_VOICE_CALL;
  beforeEach(() => {
    process.env.KIOSKX_VOICE_CALL = 'true';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.KIOSKX_VOICE_CALL;
    else process.env.KIOSKX_VOICE_CALL = original;
  });
  it.each([undefined, 'false', 'TRUE'])(
    'refuses mutation when flag is %s',
    async (flag) => {
      if (flag === undefined) delete process.env.KIOSKX_VOICE_CALL;
      else process.env.KIOSKX_VOICE_CALL = flag;
      const { service, queue, voice } = setup();
      await expect(
        service.start(KIOSKX_WORKSPACE_ID, 'fake-person', 'fake-request'),
      ).rejects.toThrow('Calling is unavailable');
      expect(
        (await service.status(KIOSKX_WORKSPACE_ID, 'fake-person')).available,
      ).toBe(false);
      expect(queue.add).not.toHaveBeenCalled();
      expect(voice.create).not.toHaveBeenCalled();
    },
  );
  it('refuses another workspace even when enabled', async () => {
    const { service, queue } = setup();
    await expect(
      service.start('apple-workspace', 'fake-person', 'fake-request'),
    ).rejects.toThrow();
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('hides the control for a person without a saved phone', async () => {
    const { service, person } = setup();
    person.findOne.mockResolvedValue({ phones: { primaryPhoneNumber: '' } });
    expect(
      (await service.status(KIOSKX_WORKSPACE_ID, 'fake-person')).available,
    ).toBe(false);
  });
  it('makes one call and atomically links the actual transcript note to this person', async () => {
    const { service, voice, notes, targets } = setup();
    expect(
      (await service.status(KIOSKX_WORKSPACE_ID, 'fake-person')).available,
    ).toBe(true);
    await service.start(KIOSKX_WORKSPACE_ID, 'fake-person', 'fake-request');
    await service.start(KIOSKX_WORKSPACE_ID, 'fake-person', 'other-request');
    await service.advance('fake-person', 'fake-operation');
    expect(voice.create).toHaveBeenCalledWith('fake-saved-phone');
    expect(notes.insert).not.toHaveBeenCalled();
    await service.advance('fake-person', 'fake-operation');
    expect(notes.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'KioskX call',
        bodyV2: expect.objectContaining({
          markdown: 'Real returned transcript',
        }),
      }),
      expect.anything(),
    );
    expect(targets.insert).toHaveBeenCalledWith(
      { noteId: 'fake-operation', targetPersonId: 'fake-person' },
      expect.anything(),
    );
    expect(voice.create).toHaveBeenCalledTimes(1);
  });
  it('does not dial a queued call after the switch is turned off', async () => {
    const { service, voice } = setup();
    await service.start(KIOSKX_WORKSPACE_ID, 'fake-person', 'fake-request');
    process.env.KIOSKX_VOICE_CALL = 'false';
    await service.advance('fake-person', 'fake-operation');
    expect(voice.create).not.toHaveBeenCalled();
  });
});
