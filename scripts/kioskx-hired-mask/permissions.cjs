// Run inside the existing server. Only supported metadata mutations write data.
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const WORKSPACE = '243e9c93-f7f9-47cc-ab7d-6a7dd6659774';
const db = new Client({ connectionString: process.env.PG_DATABASE_URL });
let step = 'preflight';
async function main() {
  await db.connect();
  const workspace = (
    await db.query(
      'SELECT subdomain,"databaseSchema" FROM core.workspace WHERE id=$1',
      [WORKSPACE],
    )
  ).rows[0];
  assert.equal(workspace?.subdomain, 'kioskx');
  assert.match(workspace.databaseSchema, /^workspace_[a-z0-9]+$/);
  const schema = `"${workspace.databaseSchema}"`;
  const roles = (
    await db.query('SELECT * FROM core.role WHERE "workspaceId"=$1', [
      WORKSPACE,
    ])
  ).rows;
  const role = roles.find((r) => r.label === 'KioskX Inbound Desk');
  assert.ok(role);
  assert.equal(role.id, '15d0420a-c8aa-49a8-8ab1-1acd4eda31e7');
  assert.equal(role.canReadAllObjectRecords, false);
  assert.equal(role.canUpdateAllSettings, false);
  assert.equal(role.canAccessAllTools, false);
  const members = (
    await db.query(
      `SELECT uw.id,uw."userId",rt."roleId",wm.id AS "memberId" FROM core."userWorkspace" uw
    JOIN core."roleTarget" rt ON rt."userWorkspaceId"=uw.id AND rt."workspaceId"=uw."workspaceId"
    JOIN ${schema}."workspaceMember" wm ON wm."userId"=uw."userId" AND wm."deletedAt" IS NULL
    WHERE uw."workspaceId"=$1 AND uw."deletedAt" IS NULL`,
      [WORKSPACE],
    )
  ).rows;
  const admin = members.find((m) =>
    roles.some((r) => r.id === m.roleId && r.label === 'Admin'),
  );
  const hired = members.filter((m) => m.roleId === role.id);
  assert.ok(admin && hired.length);
  function token(m) {
    return jwt.sign(
      {
        sub: m.userId,
        userId: m.userId,
        workspaceId: WORKSPACE,
        userWorkspaceId: m.id,
        workspaceMemberId: m.memberId,
        type: 'ACCESS',
        authProvider: 'password',
      },
      crypto
        .createHash('sha256')
        .update(`${process.env.APP_SECRET}${WORKSPACE}ACCESS`)
        .digest('hex'),
      { expiresIn: '10m' },
    );
  }
  async function api(m, path, query, variables = {}) {
    const response = await fetch(`http://localhost:3000/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token(m)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(60000),
    });
    return response.json();
  }
  const objects = (
    await db.query(
      'SELECT id,"nameSingular","namePlural","isSystem" FROM core."objectMetadata" WHERE "workspaceId"=$1',
      [WORKSPACE],
    )
  ).rows;
  const person = objects.find((o) => o.nameSingular === 'person');
  const fields = (
    await db.query(
      'SELECT id,name FROM core."fieldMetadata" WHERE "workspaceId"=$1 AND "objectMetadataId"=$2',
      [WORKSPACE, person.id],
    )
  ).rows;
  const protectedFields = ['emails', 'phones', 'searchVector'];
  assert.ok(
    protectedFields.every((name) => fields.some((f) => f.name === name)),
  );
  const before = (
    await db.query(
      'SELECT * FROM core."objectPermission" WHERE "roleId"=$1 AND "objectMetadataId"=$2',
      [role.id, person.id],
    )
  ).rows;
  assert.ok(before.every((p) => p.canReadObjectRecords !== true));
  const otherRolesBefore = JSON.stringify(
    (
      await db.query(
        'SELECT * FROM core."fieldPermission" WHERE "workspaceId"=$1 AND "roleId"<>$2 ORDER BY id',
        [WORKSPACE, role.id],
      )
    ).rows,
  );
  step = 'deny People contact fields including searchVector';
  const deniedFields = fields.filter(
    (f) => protectedFields.includes(f.name) || f.name === 'phone',
  );
  const fieldResult = await api(
    admin,
    'metadata',
    'mutation($i:UpsertFieldPermissionsInput!){upsertFieldPermissions(upsertFieldPermissionsInput:$i){fieldMetadataId canReadFieldValue}}',
    {
      i: {
        roleId: role.id,
        fieldPermissions: deniedFields.map((f) => ({
          objectMetadataId: person.id,
          fieldMetadataId: f.id,
          canReadFieldValue: false,
          canUpdateFieldValue: false,
        })),
      },
    },
  );
  assert.ok(!fieldResult.errors);
  assert.equal(
    fieldResult.data.upsertFieldPermissions.length,
    deniedFields.length,
  );
  console.log(
    'PASS: People emails, phones and searchVector denied through field permissions',
  );
  // Deny every existing object except People: copied/custom objects may contain PII too.
  // This deliberately grants no new read, including on People or on a projection.
  step = 'deny raw objects and copied projections';
  const objectResult = await api(
    admin,
    'metadata',
    'mutation($i:UpsertObjectPermissionsInput!){upsertObjectPermissions(upsertObjectPermissionsInput:$i){objectMetadataId canReadObjectRecords}}',
    {
      i: {
        roleId: role.id,
        objectPermissions: objects
          .filter((o) => o.id !== person.id && !o.isSystem)
          .map((o) => ({
            objectMetadataId: o.id,
            canReadObjectRecords: false,
            canUpdateObjectRecords: false,
            canSoftDeleteObjectRecords: false,
            canDestroyObjectRecords: false,
          })),
      },
    },
  );
  assert.ok(!objectResult.errors);
  console.log('PASS: configurable raw objects and copied projections denied');
  step = 'verify live role queries';
  let exposure = false;
  for (const m of hired) {
    for (const [name, selection] of [
      [
        'people',
        'id emails{primaryEmail} phones{primaryPhoneNumber} searchVector',
      ],
      ['notes', 'id title bodyV2{markdown}'],
      ['messageParticipants', 'id handle'],
      ['messages', 'id text'],
      ['timelineActivities', 'id properties'],
      ['workflowRuns', 'id'],
    ]) {
      const result = await api(
        m,
        'graphql',
        `{${name}(first:1){edges{node{${selection}}}}}`,
      );
      const exposed = !!result.data?.[name]?.edges?.length;
      if (exposed) {
        exposure = true;
        console.log(
          `FAIL: live hired ${name} still readable on unchanged shared image`,
        );
      } else console.log(`PASS: live hired ${name} returns no records`);
    }
    const response = await fetch('http://localhost:3000/rest/people?limit=1', {
      headers: { Authorization: `Bearer ${token(m)}` },
    });
    const rest = await response.json();
    assert.ok(!response.ok || rest.errors);
  }
  console.log('PASS: hired REST People denied');
  step = 'Admin read unchanged';
  const result = await api(
    admin,
    'graphql',
    '{people(first:20){edges{node{id emails{primaryEmail} phones{primaryPhoneNumber}}}}}',
  );
  assert.ok(
    !result.errors &&
      result.data.people.edges.some((e) => e.node.emails?.primaryEmail),
  );
  const notes = await api(
    admin,
    'graphql',
    '{notes(filter:{title:{eq:"KioskX call"}},first:1){edges{node{id title bodyV2{markdown}}}}}',
  );
  assert.ok(!notes.errors);
  console.log(
    `PASS: Admin retains contact read; existing KioskX call notes visible: ${notes.data.notes.edges.length}`,
  );
  const after = (
    await db.query(
      'SELECT * FROM core."objectPermission" WHERE "roleId"=$1 AND "objectMetadataId"=$2',
      [role.id, person.id],
    )
  ).rows;
  assert.equal(JSON.stringify(before), JSON.stringify(after));
  assert.equal(
    otherRolesBefore,
    JSON.stringify(
      (
        await db.query(
          'SELECT * FROM core."fieldPermission" WHERE "workspaceId"=$1 AND "roleId"<>$2 ORDER BY id',
          [WORKSPACE, role.id],
        )
      ).rows,
    ),
  );
  console.log(
    'PASS: no People read granted; other roles field permissions unchanged; no users created or passwords accessed',
  );
  if (exposure) process.exitCode = 2;
}
main()
  .catch(() => {
    console.log(`FAIL: ${step}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
