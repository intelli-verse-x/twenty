// Focused executable tests for the production service, permission calculator and
// React markup. Infrastructure repositories/transports are fakes; no network.
// MASK_TEST_DEPS points at an isolated npm install (see README).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const dep = createRequire(
  path.join(process.env.MASK_TEST_DEPS || process.cwd(), 'package.json'),
);
const ts = dep('typescript');
const React = dep('react');
const { renderToStaticMarkup } = dep('react-dom/server');
const root = path.resolve(__dirname, '../..');
const server = path.join(root, 'packages/twenty-server/src');
const moduleDir = path.join(server, 'modules/kioskx-hired-mask');
const noopDecorator = () => () => {};
const namedClasses = new Proxy({}, { get: (_, name) => class {} });
const standards = Object.fromEntries(
  ['workflow', 'workflowRun', 'workflowVersion', 'workspaceMember'].map(
    (name) => [name, { universalIdentifier: name }],
  ),
);
function load(file, overrides = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const m = { exports: {} };
  cache.set(file, m);
  const baseline =
    process.env.MASK_TEST_BASELINE === '1' &&
    (file.endsWith('/permissions.utils.ts') ||
      file.endsWith('/workspace-roles-permissions-cache.service.ts'));
  const source = baseline
    ? execFileSync('git', ['show', '815d4dc5:' + path.relative(root, file)], {
        cwd: root,
        encoding: 'utf8',
      })
    : fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      experimentalDecorators: true,
      emitDecoratorMetadata: false,
    },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const requireLocal = (name) => {
    if (name in overrides) return overrides[name];
    if (name.startsWith('.'))
      return load(
        path.resolve(path.dirname(file), name + '.ts'),
        overrides,
        cache,
      );
    if (name.startsWith('src/modules/kioskx-hired-mask/'))
      return load(path.join(server, name.slice(4) + '.ts'), overrides, cache);
    if (name === '@nestjs/typeorm') return { InjectRepository: noopDecorator };
    if (name === '@nestjs/graphql')
      return new Proxy({}, { get: () => noopDecorator });
    if (name === 'twenty-shared/types')
      return { MessageParticipantRole: { FROM: 'FROM' } };
    if (name === 'twenty-shared/utils')
      return { isDefined: (value) => value !== undefined && value !== null };
    if (name === 'twenty-shared/metadata')
      return { STANDARD_OBJECTS: standards };
    if (name === 'twenty-shared/constants')
      return {
        PermissionFlagType: {
          WORKFLOWS: 'WORKFLOWS',
          WORKSPACE_MEMBERS: 'WORKSPACE_MEMBERS',
        },
        SystemPermissionFlag: {},
      };
    if (name.endsWith('build-system-auth-context.util'))
      return {
        buildSystemAuthContext: (workspaceId) => ({
          workspace: { id: workspaceId },
          type: 'system',
        }),
      };
    if (name.endsWith('workspace-cache-provider.service'))
      return { WorkspaceCacheProvider: class {} };
    if (name.endsWith('workspace-cache.decorator'))
      return { WorkspaceCache: noopDecorator };
    if (name.endsWith('inject-workspace-scoped-repository.decorator'))
      return { InjectWorkspaceScopedRepository: noopDecorator };
    if (name.endsWith('regroup-entities-by-related-entity-id'))
      return {
        regroupEntitiesByRelatedEntityId: ({ entities, foreignKey }) => {
          const map = new Map();
          for (const e of entities)
            map.set(e[foreignKey], [...(map.get(e[foreignKey]) ?? []), e]);
          return map;
        },
      };
    if (name.startsWith('src/')) return namedClasses;
    return dep(name);
  };
  new Function('require', 'module', 'exports', compiled.outputText)(
    requireLocal,
    m,
    m.exports,
  );
  return m.exports;
}
const { redactContactText, inquiryText } = load(
  path.join(moduleDir, 'kioskx-redact.ts'),
);
const {
  KIOSKX_DESK_WORKSPACE: workspace,
  KIOSKX_DESK_ROLE: role,
  KIOSKX_DESK_ROLE_ID: roleId,
} = load(path.join(moduleDir, 'kioskx-desk-policy.ts'));
const { KioskxHiredMaskService } = load(
  path.join(moduleDir, 'kioskx-hired-mask.service.ts'),
);
const personId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const email = 'fixture@example.invalid';
const phone = '2025550147';
const noContact = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(!text.includes(email));
  assert.ok(!text.includes(phone));
  assert.doesNotMatch(text, /mailto:|tel:|@|\d{5,}/);
};
function fixture(options = {}) {
  const calls = [],
    emails = [],
    claims = new Map();
  const person = {
    id: personId,
    emails: { primaryEmail: options.noEmail ? '' : email },
    phones: {
      primaryPhoneNumber: options.noPhone ? '' : phone,
      primaryPhoneCallingCode: '1',
    },
  };
  const repositories = {
    person: { findOne: async () => (options.missing ? null : person) },
    noteTarget: {
      find: async () => [{ noteId: 'inquiry' }, { noteId: 'transcript' }],
    },
    note: {
      find: async (args) =>
        [
          {
            id: 'inquiry',
            title: 'KioskX contact form',
            bodyV2: {
              markdown: `Please respond to ${email} or +1 (202) 555-0147 about delivery.`,
            },
          },
          {
            id: 'transcript',
            title: 'KioskX call',
            bodyV2: { markdown: 'PRIVATE TRANSCRIPT' },
          },
        ].filter((n) => n.title === args.where.title),
      insert: async (value) => {
        if (claims.has(value.id)) throw Error('duplicate');
        claims.set(value.id, value.title);
      },
      update: async (id, value) => claims.set(id, value.title),
    },
    messageParticipant: {
      find: async (args) => {
        assert.equal(args.where.role, 'FROM');
        assert.equal(args.where.personId, personId);
        return [{ messageId: 'reply' }];
      },
    },
    message: {
      find: async () => [
        {
          text: `From: ${email}\nCc: other@example.invalid\nThe reply is yes. Call +1 (202) 555-0147.`,
        },
      ],
    },
  };
  const service = new KioskxHiredMaskService(
    {
      findOne: async () => ({
        roleId: options.role && options.role !== role ? options.role : roleId,
      }),
    },
    { findOne: async () => (options.noAccount ? null : { id: 'shared' }) },
    {
      executeInWorkspaceContext: async (fn) => fn(),
      getRepository: async (_, name) => repositories[name],
    },
    {
      composeEmail: async (params) => {
        emails.push(params);
        return { success: true, data: { shouldPersistMessage: false } };
      },
    },
    {
      sendComposedEmail: async () => {
        if (options.sendError) throw Error(`${email} ${phone}`);
        return {};
      },
    },
    options.noVoice
      ? undefined
      : {
          start: async (value) => {
            calls.push(value);
            if (options.callError) throw Error(phone);
          },
        },
  );
  return { service, calls, emails, claims };
}
process.env.KIOSKX_HIRED_EMAIL_ACCOUNT_ID =
  '33333333-3333-4333-8333-333333333333';

test('real inquiry and reply text survives with contacts and headers removed', async () => {
  const { service } = fixture();
  const result = await service.contact(workspace, 'hired', personId);
  noContact(result);
  assert.equal(result.hasEmail, true);
  assert.equal(result.hasPhone, true);
  assert.match(result.entries[0].text, /about delivery/);
  assert.match(result.entries[1].text, /The reply is yes/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE TRANSCRIPT|From:|Cc:|To:/,
  );
});
test('HTML entities, links, unicode and rich-text contact data are removed', () => {
  for (const text of [
    `<a href="mailto:${email}">hello</a> ${email} +1 (202) 555-0147`,
    'a&#64;example.invalid &#49;&#50;&#51;&#52;&#53;&#54;&#55;',
    'ＦＩＸＴＵＲＥ＠ｅｘａｍｐｌｅ．ｉｎｖａｌｉｄ １２３４５６７８９',
    'Call 202.555.0147 / +44 20 7946 0958 / １２３４５ / ١٢٣٤٥٦٧٨٩',
  ])
    noContact(redactContactText(text));
  noContact(
    inquiryText({
      blocknote: JSON.stringify([
        { content: [{ text: email }, { text: phone }] },
      ]),
    }),
  );
});
test('missing destinations omit capabilities and cannot send or call', async () => {
  const { service, calls, emails } = fixture({ noEmail: true, noPhone: true });
  const result = await service.contact(workspace, 'hired', personId);
  assert.equal(result.hasEmail, false);
  assert.equal(result.hasPhone, false);
  for (const action of ['email', 'call'])
    assert.deepEqual(
      await service.action(workspace, 'hired', {
        personId,
        requestId,
        action,
        subject: 'Test',
        body: 'Test',
      }),
      { ok: false, status: 'unavailable' },
    );
  assert.equal(calls.length + emails.length, 0);
});
test('server resolves email; mutation returns only ok and sent; replay cannot send twice', async () => {
  const { service, emails, claims } = fixture();
  const input = {
    personId,
    requestId,
    action: 'email',
    subject: 'Fixture',
    body: 'Fixture message',
  };
  const result = await service.action(workspace, 'hired', input);
  assert.deepEqual(result, { ok: true, status: 'sent' });
  noContact(result);
  assert.equal(emails[0].recipients.to, email);
  assert.equal(claims.size, 1);
  assert.equal(
    (await service.action(workspace, 'hired', input)).status,
    'alreadySubmitted',
  );
  assert.equal(emails.length, 1);
});
test('ambiguous email response never leaks provider exception and cannot replay', async () => {
  const { service, emails } = fixture({ sendError: true });
  const input = {
    personId,
    requestId,
    action: 'email',
    subject: 'Fixture',
    body: 'Fixture',
  };
  assert.deepEqual(await service.action(workspace, 'hired', input), {
    ok: false,
    status: 'unknown',
  });
  assert.equal(
    (await service.action(workspace, 'hired', input)).status,
    'alreadySubmitted',
  );
  assert.equal(emails.length, 1);
});
test('call is default off; fake transport enabled explicitly receives server-resolved number', async () => {
  delete process.env.KIOSKX_VOICE_CALL;
  const { service, calls } = fixture();
  const input = { personId, requestId, action: 'call' };
  assert.equal(
    (await service.contact(workspace, 'hired', personId)).callAvailable,
    false,
  );
  assert.equal(
    (await service.action(workspace, 'hired', input)).status,
    'unavailable',
  );
  assert.equal(calls.length, 0);
  process.env.KIOSKX_VOICE_CALL = 'true';
  assert.deepEqual(await service.action(workspace, 'hired', input), {
    ok: true,
    status: 'callStarted',
  });
  assert.equal(calls[0].phone, '+12025550147');
  assert.equal(
    (await service.action(workspace, 'hired', input)).status,
    'alreadySubmitted',
  );
  assert.equal(calls.length, 1);
  assert.equal(
    (
      await fixture({ noVoice: true }).service.contact(
        workspace,
        'hired',
        personId,
      )
    ).callAvailable,
    false,
  );
  delete process.env.KIOSKX_VOICE_CALL;
});
test('wrong workspace, unauthenticated user and Admin/Member cannot use desk escalation', async () => {
  for (const [ws, user, label] of [
    ['apple', 'hired', role],
    [workspace, '', role],
    [workspace, 'admin', 'Admin'],
    [workspace, 'member', 'Member'],
  ]) {
    const { service, calls, emails } = fixture({ role: label });
    assert.equal(await service.contact(ws, user, personId), null);
    await assert.rejects(
      service.action(ws, user, { personId, requestId, action: 'call' }),
    );
    assert.equal(calls.length + emails.length, 0);
  }
});
test('rendered chips and redacted replies contain no contacts, links or clipboard action', async () => {
  const contact = await fixture().service.contact(workspace, 'hired', personId);
  const frontend = path.join(
    root,
    'packages/twenty-front/src/modules/kioskx-hired-mask/KioskxHiredContact.tsx',
  );
  const components = load(frontend, {
    '@apollo/client/react': {
      useQuery: () => ({ data: { kioskxDeskContact: contact } }),
      useMutation: () => [async () => {}, { loading: false }],
    },
  });
  const markup = renderToStaticMarkup(
    React.createElement(components.KioskxHiredContact, { personId }),
  );
  noContact(markup);
  assert.match(markup, /aria-label="Email"/);
  assert.match(markup, /aria-label="Call"/);
  assert.match(markup, /blur/);
  assert.doesNotMatch(markup, /href=|clipboard|PRIVATE TRANSCRIPT/);
  contact.hasEmail = false;
  contact.hasPhone = false;
  const empty = renderToStaticMarkup(
    React.createElement(components.KioskxHiredContact, { personId }),
  );
  assert.doesNotMatch(empty, /aria-label="Email"|aria-label="Call"/);
});
test('actual permission calculator denies raw objects only for KioskX desk, preserving Admin and Member', async () => {
  const { WorkspaceRolesPermissionsCacheService } = load(
    path.join(
      server,
      'engine/metadata-modules/role/services/workspace-roles-permissions-cache.service.ts',
    ),
  );
  const roles = [
    { id: roleId, label: role, canReadAllObjectRecords: false },
    {
      id: 'admin',
      label: 'Admin',
      canReadAllObjectRecords: true,
      canUpdateAllSettings: true,
    },
    { id: 'member', label: 'Member', canReadAllObjectRecords: true },
  ];
  const objects = [
    'person',
    'note',
    'message',
    'messageParticipant',
    'timelineActivity',
    'workflowRun',
    'callRecording',
  ].map((name) => ({
    id: name,
    nameSingular: name,
    isSystem: !['person', 'note'].includes(name),
    universalIdentifier: name,
  }));
  const repo = (data) => ({ find: async () => data });
  const service = new WorkspaceRolesPermissionsCacheService(
    repo(objects),
    repo(roles),
    repo([{ roleId, objectMetadataId: 'person', canReadObjectRecords: true }]),
    repo([]),
    repo(
      ['emails', 'phones', 'searchVector'].map((name) => ({
        roleId,
        objectMetadataId: 'person',
        fieldMetadataId: name,
        canReadFieldValue: false,
      })),
    ),
    repo([]),
    repo([]),
  );
  const permissions = await service.computeForCache(workspace);
  assert.equal(permissions[roleId].person.canReadObjectRecords, true);
  for (const name of ['emails', 'phones', 'searchVector']) {
    assert.equal(
      permissions[roleId].person.restrictedFields[name].canRead,
      false,
    );
    assert.equal(permissions.admin.person.restrictedFields[name], undefined);
  }
  for (const name of [
    'note',
    'message',
    'messageParticipant',
    'timelineActivity',
    'workflowRun',
    'callRecording',
  ]) {
    assert.equal(permissions[roleId][name].canReadObjectRecords, false);
    assert.equal(permissions.admin[name].canReadObjectRecords, true);
  }
  assert.equal(permissions.member.person.canReadObjectRecords, true);
  const apple = await service.computeForCache('apple');
  assert.equal(apple[roleId].timelineActivity.canReadObjectRecords, true);
});

test('actual ORM boundary blocks system-object bypass and restricted People fields, preserving Admin reads', async () => {
  const context = {
    authContext: {
      type: 'user',
      workspace: { id: workspace },
      userWorkspaceId: 'hired',
    },
    userWorkspaceRoleMap: { hired: roleId },
  };
  const { validateOperationIsPermittedOrThrow } = load(
    path.join(server, 'engine/twenty-orm/repository/permissions.utils.ts'),
    {
      '@sniptt/guards': {
        isNonEmptyString: (value) => typeof value === 'string' && !!value,
      },
      'lodash.isempty': {
        default: (value) => !value || Object.keys(value).length === 0,
      },
      'src/engine/twenty-orm/storage/orm-workspace-context.storage': {
        workspaceContextStorage: { getStore: () => context },
      },
      'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util':
        {
          findFlatEntityByIdInFlatEntityMaps: ({
            flatEntityId,
            flatEntityMaps,
          }) => flatEntityMaps[flatEntityId],
        },
      'src/engine/metadata-modules/permissions/permissions.exception': {
        PermissionsException: class extends Error {},
        PermissionsExceptionCode: { PERMISSION_DENIED: 'DENIED' },
        PermissionsExceptionMessage: { PERMISSION_DENIED: 'DENIED' },
      },
      'src/engine/twenty-orm/utils/get-column-name-to-field-metadata-id.util': {
        getColumnNameToFieldMetadataIdMap: () => ({
          emailsPrimaryEmail: 'emails',
          phonesPrimaryPhoneNumber: 'phones',
          searchVector: 'searchVector',
          id: 'id',
          title: 'title',
        }),
      },
    },
  );
  const args = (name) => ({
    entityName: name,
    operationType: 'select',
    objectsPermissions: {
      [name]: {
        canReadObjectRecords: true,
        restrictedFields: {
          emails: { canRead: false },
          phones: { canRead: false },
          searchVector: { canRead: false },
        },
      },
    },
    flatObjectMetadataMaps: {
      [name]: { id: name, isSystem: name !== 'person' && name !== 'note' },
    },
    flatFieldMetadataMaps: {},
    objectIdByNameSingular: { [name]: name },
    selectedColumns: ['id'],
    allFieldsSelected: false,
    updatedColumns: [],
  });
  for (const object of [
    'messageParticipant',
    'timelineActivity',
    'workflowRun',
    'message',
    'callRecording',
    'note',
  ])
    assert.throws(
      () => validateOperationIsPermittedOrThrow(args(object)),
      /DENIED/,
    );
  for (const field of [
    'emailsPrimaryEmail',
    'phonesPrimaryPhoneNumber',
    'searchVector',
  ])
    assert.throws(
      () =>
        validateOperationIsPermittedOrThrow({
          ...args('person'),
          selectedColumns: [field],
        }),
      /DENIED/,
    );
  assert.doesNotThrow(() =>
    validateOperationIsPermittedOrThrow(args('person')),
  );
  context.authContext.userWorkspaceId = 'admin';
  for (const object of [
    'messageParticipant',
    'timelineActivity',
    'workflowRun',
    'message',
    'callRecording',
    'note',
    'person',
  ]) {
    const admin = args(object);
    admin.objectsPermissions[object].restrictedFields = {};
    assert.doesNotThrow(() => validateOperationIsPermittedOrThrow(admin));
  }
  const { graphql, buildSchema } = dep('graphql');
  const schema = buildSchema(
    'type Person { email: String phone: String } type Note { title: String text: String } type Query { person: Person note: Note }',
  );
  let adminQuery = false;
  const rootValue = {
    person: () => {
      const query = args('person');
      query.selectedColumns = [
        'emailsPrimaryEmail',
        'phonesPrimaryPhoneNumber',
      ];
      if (adminQuery) query.objectsPermissions.person.restrictedFields = {};
      validateOperationIsPermittedOrThrow(query);
      return { email, phone };
    },
    note: () => {
      validateOperationIsPermittedOrThrow(args('note'));
      return { title: 'KioskX call', text: 'FULL TEST TRANSCRIPT' };
    },
  };
  const source = '{ person { email phone } note { title text } }';
  context.authContext.userWorkspaceId = 'hired';
  const hiredQuery = await graphql({ schema, source, rootValue });
  assert.equal(hiredQuery.data.person, null);
  assert.equal(hiredQuery.data.note, null);
  noContact(hiredQuery);
  assert.doesNotMatch(JSON.stringify(hiredQuery), /FULL TEST TRANSCRIPT/);
  context.authContext.userWorkspaceId = 'admin';
  adminQuery = true;
  const adminResult = await graphql({ schema, source, rootValue });
  assert.equal(adminResult.errors, undefined);
  assert.equal(adminResult.data.person.email, email);
  assert.equal(adminResult.data.note.title, 'KioskX call');
  assert.equal(adminResult.data.note.text, 'FULL TEST TRANSCRIPT');
  context.authContext.workspace.id = 'apple';
  context.authContext.userWorkspaceId = 'hired';
  assert.doesNotThrow(() =>
    validateOperationIsPermittedOrThrow(args('timelineActivity')),
  );
});

test('read failures return only an unavailable state, never a provider error', async () => {
  const { service } = fixture();
  service.orm.getRepository = async () => {
    throw Error(`${email} ${phone}`);
  };
  const result = await service.contact(workspace, 'hired', personId);
  noContact(result);
  assert.equal(result.unavailable, true);
  assert.deepEqual(result.entries, []);
});

test('ambiguous fake dial is not retried and leaks no phone number', async () => {
  process.env.KIOSKX_VOICE_CALL = 'true';
  try {
    const { service, calls } = fixture({ callError: true });
    const input = { personId, requestId, action: 'call' };
    const result = await service.action(workspace, 'hired', input);
    assert.deepEqual(result, { ok: false, status: 'unknown' });
    noContact(result);
    assert.equal(
      (await service.action(workspace, 'hired', input)).status,
      'alreadySubmitted',
    );
    assert.equal(calls.length, 1);
  } finally {
    delete process.env.KIOSKX_VOICE_CALL;
  }
});
