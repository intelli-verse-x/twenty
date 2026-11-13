import { SalesDeskService } from './sales-desk.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

jest.mock(
  'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager',
  () => ({ GlobalWorkspaceOrmManager: class {} }),
);
jest.mock('src/engine/twenty-orm/utils/build-system-auth-context.util', () => ({
  buildSystemAuthContext: (workspaceId: string) => ({ workspaceId }),
}));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => {
    throw new Error('Transport must not be opened');
  }),
}));
const stored = new Map<string, any>();
const notes = {
  findOne: jest.fn(async ({ where }) => stored.get(where.id)),
  upsert: jest.fn(async (note) => {
    stored.set(note.id, note);
  }),
  insert: jest.fn(),
  update: jest.fn(),
};
const orm = {
  executeInWorkspaceContext: jest.fn(async (fn) => fn()),
  getRepository: jest.fn(async () => notes),
};
const make = () =>
  new SalesDeskService(orm as unknown as GlobalWorkspaceOrmManager);
let environment: NodeJS.ProcessEnv;
beforeEach(() => {
  environment = { ...process.env };
  stored.clear();
  jest.clearAllMocks();
  for (const key of [
    'DESK_SALES_EMAILS',
    'DESK_SALES_FIXTURES',
    'DESK_TURO_REPORT_JSON',
    'DESK_SALES_EMAIL',
    'DESK_SALES_VOICE',
  ])
    delete process.env[key];
});
afterEach(() => {
  process.env = environment;
});
it('defaults to a closed allowlist and unavailable channels', () => {
  const desk = make();
  expect(desk.allowed('fixture@example.test')).toBe(false);
  expect(desk.channels()).toEqual({
    email: false,
    voice: false,
    voiceStatus: 'Calling is off.',
  });
});
it('normalizes comma-separated allowlisted emails', () => {
  process.env.DESK_SALES_EMAILS =
    ' Fixture.One@example.test, fixture.two@example.test ';
  expect(make().allowed('FIXTURE.ONE@example.test')).toBe(true);
  expect(make().allowed('outsider@example.test')).toBe(false);
});
it.each(['cleaning', 'cars', 'jobs'] as const)(
  'default %s has no fabricated records',
  async (queue) => {
    expect(await make().read('workspace-fixture', queue)).toEqual({
      rows: [],
      empty: 'No requests are connected to this queue yet.',
    });
    expect(orm.getRepository).not.toHaveBeenCalled();
  },
);
it('shows Turo as not connected by default', async () => {
  expect(await make().read('workspace-fixture', 'turo')).toEqual({
    rows: [],
    empty: 'The fleet report is not connected.',
  });
});
it('loads Turo only from an explicit report fixture', async () => {
  process.env.DESK_TURO_REPORT_JSON = JSON.stringify({
    cars: [
      {
        name: 'Fixture Car',
        idleGap: 'Fixture 2 days',
        hostEarn: 'Fixture USD 100',
        paidByTuro: 'Fixture USD 80',
      },
    ],
  });
  const result = await make().read('workspace-fixture', 'turo');
  expect(result.rows[0].inquiry).toContain(
    'Money Turo has sent: Fixture USD 80',
  );
  expect(result.rows[0]).not.toHaveProperty('hiringStatus');
  expect(result.rows[0]).not.toHaveProperty('stage');
});
it.each(['bad json', '{"cars":[{}]}'])(
  'rejects a malformed report instead of inventing a fleet',
  async (raw) => {
    process.env.DESK_TURO_REPORT_JSON = raw;
    await expect(make().read('workspace-fixture', 'turo')).rejects.toThrow();
  },
);
it('fixtures show inquiries and all three supported job roles', async () => {
  process.env.DESK_SALES_FIXTURES = 'true';
  expect(
    (await make().read('workspace-fixture', 'cleaning')).rows[0].inquiry,
  ).toContain('Office cleaning request');
  const result = await make().read('workspace-fixture', 'jobs');
  expect(result.rows.map((row) => row.inquiry)).toEqual([
    'Role: truck driver',
    'Role: delivery helper',
    'Role: housekeeper',
  ]);
  expect(result.rows.every((row) => row.hiringStatus === 'new')).toBe(true);
});
it.each([
  [{}, 'Next step and Due time required.'],
  [{ dueAt: '2026-12-01T10:00:00Z' }, 'Next step required.'],
  [{ nextStep: 'Confirm scope' }, 'Due time required.'],
])(
  'missing follow-up leaves the request in its queue',
  async (input, message) => {
    process.env.DESK_SALES_FIXTURES = 'true';
    const desk = make();
    await expect(
      desk.save('workspace-fixture', 'cleaning', 'fixture-cleaning', input),
    ).rejects.toThrow(message);
    expect(notes.upsert).not.toHaveBeenCalled();
    expect(
      (await desk.read('workspace-fixture', 'cleaning')).rows,
    ).toHaveLength(1);
  },
);
it('stores a follow-up durably and reads it through a new service instance', async () => {
  process.env.DESK_SALES_FIXTURES = 'true';
  await make().save('workspace-fixture', 'cleaning', 'fixture-cleaning', {
    nextStep: 'Confirm scope',
    dueAt: '2026-12-01T10:00:00Z',
  });
  expect(
    (await make().read('workspace-fixture', 'cleaning')).rows[0],
  ).toMatchObject({
    nextStep: 'Confirm scope',
    dueAt: '2026-12-01T10:00:00.000Z',
  });
  expect(
    (await make().read('another-workspace', 'cleaning')).rows[0].nextStep,
  ).toBeUndefined();
});
it('updates hiring status without adding sales stage or deal value', async () => {
  process.env.DESK_SALES_FIXTURES = 'true';
  await make().save('workspace-fixture', 'jobs', 'fixture-job-0', {
    hiringStatus: 'reviewing',
    stage: 'won',
    dealValue: 100,
  });
  const row = (await make().read('workspace-fixture', 'jobs')).rows[0];
  expect(row.hiringStatus).toBe('reviewing');
  expect(row).not.toHaveProperty('stage');
  expect(row).not.toHaveProperty('dealValue');
});
it('rejects report writes and invalid hiring states', async () => {
  process.env.DESK_SALES_FIXTURES = 'true';
  await expect(
    make().save('workspace-fixture', 'turo', 'fixture', {}),
  ).rejects.toThrow('read-only');
  await expect(
    make().save('workspace-fixture', 'jobs', 'fixture-job-0', {
      hiringStatus: 'won',
    }),
  ).rejects.toThrow('Hiring status');
});
it('off-channel actions never open a transport or create a claim', async () => {
  process.env.DESK_SALES_FIXTURES = 'true';
  const desk = make();
  expect(
    await desk.email(
      'workspace-fixture',
      'cleaning',
      'fixture-cleaning',
      'fixture',
      'Fixture draft',
    ),
  ).toEqual({ status: 'unavailable' });
  expect(desk.call()).toEqual({ status: 'unavailable' });
  expect(notes.insert).not.toHaveBeenCalled();
});
it('propagates a failed queue read and leaves independent Turo readable', async () => {
  process.env.DESK_SALES_FIXTURES = 'true';
  notes.findOne.mockRejectedValueOnce(new Error('offline'));
  await expect(make().read('workspace-fixture', 'cars')).rejects.toThrow(
    'offline',
  );
  expect((await make().read('workspace-fixture', 'turo')).empty).toContain(
    'not connected',
  );
});
