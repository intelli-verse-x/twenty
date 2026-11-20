/* Executed by run.py inside the EXISTING Twenty container; no image/pod files change.
 * This provisions a disabled non-admin identity and a closed role, then probes RLS.
 * It deliberately does not claim to install a working desk on an unsupported server.
 */
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { WORKSPACE_ID, ROLE_LABEL, CONTACT_SOURCE, ROLE_POLICY,
  PRIVATE_PERSON_FIELDS, closedObjectPermissions, privateFieldPermissions, assertClosedRole } = globalThis.inboundPolicy;
const credentials = globalThis.inboundCredentials;
const db = new Client({ connectionString: process.env.PG_DATABASE_URL });

function accessToken(userWorkspace, memberId) {
  return jwt.sign({ sub: userWorkspace.userId, userId: userWorkspace.userId,
    workspaceId: WORKSPACE_ID, userWorkspaceId: userWorkspace.id,
    workspaceMemberId: memberId, type: 'ACCESS', authProvider: 'password' },
  crypto.createHash('sha256').update(`${process.env.APP_SECRET}${WORKSPACE_ID}ACCESS`).digest('hex'),
  { expiresIn: '5m' });
}
async function request(token, query, variables = {}, endpoint = 'metadata') {
  const response = await fetch(`http://localhost:3000/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000),
  });
  return response.json();
}
function requireData(result, operation) {
  // API errors may contain values or credential-bearing URLs: don't log raw errors.
  if (result.errors || !result.data) throw new Error(`${operation} rejected`);
  return result.data;
}
async function main() {
  await db.connect();
  const workspace = (await db.query('SELECT id, subdomain, "databaseSchema" FROM core.workspace WHERE id=$1', [WORKSPACE_ID])).rows[0];
  assert.equal(workspace?.subdomain, 'kioskx');
  assert.match(workspace.databaseSchema, /^workspace_[a-z0-9]+$/);
  const schema = `"${workspace.databaseSchema}"`;
  const admin = (await db.query(`SELECT uw.id, uw."userId" FROM core."userWorkspace" uw
    JOIN core."roleTarget" rt ON rt."userWorkspaceId"=uw.id
    JOIN core.role r ON r.id=rt."roleId"
    WHERE uw."workspaceId"=$1 AND uw."deletedAt" IS NULL AND r.label='Admin' LIMIT 1`, [WORKSPACE_ID])).rows[0];
  assert.ok(admin, 'Workspace admin required');
  const member = (await db.query(`SELECT id FROM ${schema}."workspaceMember" WHERE "userId"=$1 AND "deletedAt" IS NULL`, [admin.userId])).rows[0];
  const token = accessToken(admin, member.id);
  const api = async (query, variables, label) => { console.log('Applying: ' + label); return requireData(await request(token, query, variables), label); };
  let role = (await db.query('SELECT * FROM core.role WHERE "workspaceId"=$1 AND label=$2', [WORKSPACE_ID, ROLE_LABEL])).rows[0];
  if (!role) {
    role = (await api('mutation($i:CreateRoleInput!){createOneRole(createRoleInput:$i){id}}', { i: ROLE_POLICY }, 'Create closed role')).createOneRole;
  } else {
    // Refuse to change a role used by anybody other than our reserved identity.
    const targets = (await db.query(`SELECT u.email FROM core."roleTarget" rt
      LEFT JOIN core."userWorkspace" uw ON uw.id=rt."userWorkspaceId"
      LEFT JOIN core."user" u ON u.id=uw."userId" WHERE rt."roleId"=$1`, [role.id])).rows;
    assert.ok(targets.every((target) => target.email === credentials.email), 'Role has an unexpected assignee');
    await api('mutation($i:UpdateRoleInput!){updateOneRole(updateRoleInput:$i){id}}',
      { i: { id: role.id, update: ROLE_POLICY } }, 'Reset closed role');
  }
  const objects = (await db.query('SELECT id,"nameSingular","isSystem" FROM core."objectMetadata" WHERE "workspaceId"=$1', [WORKSPACE_ID])).rows;
  const person = objects.find((object) => object.nameSingular === 'person');
  assert.ok(person);
  const fields = (await db.query('SELECT id,name FROM core."fieldMetadata" WHERE "objectMetadataId"=$1 AND "workspaceId"=$2', [person.id, WORKSPACE_ID])).rows;
  await api('mutation($i:UpsertObjectPermissionsInput!){upsertObjectPermissions(upsertObjectPermissionsInput:$i){objectMetadataId}}',
    { i: { roleId: role.id, objectPermissions: closedObjectPermissions(objects) } }, 'Deny record access');
  await api('mutation($i:UpsertPermissionFlagsInput!){upsertPermissionFlags(upsertPermissionFlagsInput:$i){id}}',
    { i: { roleId: role.id, permissionFlagKeys: [] } }, 'Deny tools and settings');
  await api('mutation($i:UpsertFieldPermissionsInput!){upsertFieldPermissions(upsertFieldPermissionsInput:$i){id}}',
    { i: { roleId: role.id, fieldPermissions: privateFieldPermissions(person, fields) } }, 'Hide private fields');

  // Explicitly exercise the supported API. Never insert predicates directly into
  // PostgreSQL to sidestep the server's Enterprise entitlement check.
  const restriction = await request(token,
    'mutation($i:UpsertRowLevelPermissionPredicatesInput!){upsertRowLevelPermissionPredicates(input:$i){predicates{id}}}',
    { i: { roleId: role.id, objectMetadataId: person.id,
      predicates: [{ fieldMetadataId: fields.find((f) => f.name === 'jobTitle').id,
        operand: 'IS', value: CONTACT_SOURCE }], predicateGroups: [] } });
  const rowPermissionUnavailable = restriction.errors?.some((error) =>
    error.message === 'Row level permission predicate feature is disabled');
  if (restriction.errors && !rowPermissionUnavailable) throw new Error('Unexpected row permission failure');

  // Reserve exactly one disabled hired identity; no invitation or email is sent.
  // A rerun requires the same private credential file. Never change another user.
  role = (await db.query('SELECT * FROM core.role WHERE id=$1 AND "workspaceId"=$2', [role.id, WORKSPACE_ID])).rows[0];
  let hired;
  let hiredMember;
  await db.query('BEGIN');
  try {
    const existing = (await db.query('SELECT id FROM core."user" WHERE email=$1', [credentials.email])).rows[0];
    if (existing) {
      hired = (await db.query(`SELECT uw.id,uw."userId" FROM core."userWorkspace" uw
        JOIN core."roleTarget" rt ON rt."userWorkspaceId"=uw.id
        WHERE uw."userId"=$1 AND uw."workspaceId"=$2 AND rt."roleId"=$3`, [existing.id, WORKSPACE_ID, role.id])).rows[0];
      assert.ok(hired, 'Existing identity is not this desk member');
      assert.equal((await db.query('SELECT count(*)::int AS count FROM core."userWorkspace" WHERE "userId"=$1', [existing.id])).rows[0].count, 1);
      await db.query('UPDATE core."user" SET disabled=true WHERE id=$1', [existing.id]);
      hiredMember = (await db.query(`SELECT id FROM ${schema}."workspaceMember" WHERE "userId"=$1`, [existing.id])).rows[0];
    } else {
      const hash = await bcrypt.hash(credentials.password, 12);
      const user = (await db.query(`INSERT INTO core."user" (email,"passwordHash","firstName","lastName",disabled,"isEmailVerified","canImpersonate","canAccessFullAdminPanel")
        VALUES ($1,$2,'Inbound','Desk',true,true,false,false) RETURNING id`, [credentials.email, hash])).rows[0];
      hired = (await db.query('INSERT INTO core."userWorkspace" ("userId","workspaceId",locale) VALUES ($1,$2,$3) RETURNING id,"userId"', [user.id, WORKSPACE_ID, 'en'])).rows[0];
      hiredMember = (await db.query(`INSERT INTO ${schema}."workspaceMember" ("userId","nameFirstName","nameLastName","userEmail",locale,"timeZone")
        VALUES ($1,'Inbound','Desk',$2,'en','America/Chicago') RETURNING id`, [user.id, credentials.email])).rows[0];
      await db.query(`INSERT INTO core."roleTarget" ("workspaceId","roleId","userWorkspaceId","universalIdentifier","applicationId") VALUES ($1,$2,$3,$4,$5)`,
        [WORKSPACE_ID, role.id, hired.id, crypto.randomUUID(), role.applicationId]);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }

  // SQL identity creation needs only these Kioskx cache entries invalidated.
  // Never flush Redis or invalidate another workspace.
  const redis = new (require('ioredis'))(process.env.REDIS_URL);
  redis.on('error', () => {});
  try {
    const keys = ['flat-maps:workspace-member', 'flat-maps:role-target', 'metadata:permissions:user-workspace-role-map']
      .flatMap((key) => ['hash', 'data'].map((suffix) => `engine:workspace:${key}:${WORKSPACE_ID}:${suffix}`));
    await redis.del(...keys);
  } finally { await redis.quit(); }

  const objectPermissions = (await db.query('SELECT * FROM core."objectPermission" WHERE "roleId"=$1', [role.id])).rows;
  const flags = (await db.query('SELECT * FROM core."rolePermissionFlag" WHERE "roleId"=$1', [role.id])).rows;
  assertClosedRole(role, objectPermissions, flags);
  const privatePermissions = (await db.query(`SELECT f.name,fp."canReadFieldValue",fp."canUpdateFieldValue" FROM core."fieldPermission" fp
    JOIN core."fieldMetadata" f ON f.id=fp."fieldMetadataId" WHERE fp."roleId"=$1 AND f."objectMetadataId"=$2`, [role.id, person.id])).rows;
  assert.deepEqual(privatePermissions.filter((p) => p.canReadFieldValue === false).map((p) => p.name).sort(), [...PRIVATE_PERSON_FIELDS].sort());
  console.log('PASS: persisted role has no readable standard objects, tools or settings permissions');
  console.log('PASS: persisted emails, phones and searchVector field reads are denied');

  // Run actual server requests with a short-lived hired principal, never an API
  // key with admin rights. Disabled status is restored even when a probe fails.
  let deniedQueries = 0;
  try {
    await db.query('UPDATE core."user" SET disabled=false WHERE id=$1', [hired.userId]);
    const hiredToken = accessToken(hired, hiredMember.id);
    for (const objectName of ['people','companies','opportunities','tasks','notes','dashboards','workflows']) {
      const payload = await request(hiredToken, `{ ${objectName}(first:1){edges{node{id}}} }`, {}, 'graphql');
      assert.ok(payload.errors?.some((e) => /permission|forbidden|not allowed|not authorized/i.test(e.message)), `Expected record denial for ${objectName}`);
      assert.ok(!payload.data?.[objectName]?.edges?.length, 'Record data escaped closed role');
      assert.doesNotMatch(JSON.stringify(payload), /mailto:|tel:/i, 'Contact URI escaped into lead payload');
      deniedQueries++;
    }
  } finally {
    await db.query('UPDATE core."user" SET disabled=true WHERE id=$1', [hired.userId]);
    const statusCache = new (require('ioredis'))(process.env.REDIS_URL);
    statusCache.on('error', () => {});
    try {
      await statusCache.del(`engine:core-entity:user:${hired.userId}:hash`, `engine:core-entity:user:${hired.userId}:data`);
    } finally { await statusCache.quit(); }
  }
  console.log(`PASS: ${deniedQueries} hired-principal record queries denied; no mailto/tel in responses`);
  const counts = (await db.query(`SELECT count(*)::int AS count FROM ${schema}.person WHERE "jobTitle"=$1 AND "deletedAt" IS NULL`, [CONTACT_SOURCE])).rows[0];
  const accounts = (await db.query('SELECT count(*)::int AS count FROM core."connectedAccount" WHERE "workspaceId"=$1 AND "archivedAt" IS NULL', [WORKSPACE_ID])).rows[0];
  console.log(JSON.stringify({ contactPeople: counts.count, connectedAccounts: accounts.count,
    rowPermissionUnavailable: !!rowPermissionUnavailable, hiredAccountDisabled: true, deskReady: false }));
  // This setup is a preflight/reservation, never a successful desk deployment.
  process.exitCode = 2;
}
main().catch(() => { console.error('Inbound provisioning/probe failed. No credentials or server errors printed.'); process.exitCode = 1; })
  .finally(() => db.end());
