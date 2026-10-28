const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_POLICY, closedObjectPermissions, privateFieldPermissions, assertClosedRole } = require('./policy.cjs');
const names = ['person', 'company', 'opportunity', 'task', 'note', 'dashboard', 'workflow'];
const objects = names.map((name) => ({ id: name, nameSingular: name, isSystem: false }));
const permissions = closedObjectPermissions(objects);

test('hired role cannot read the People directory or other standard objects', () => {
  for (const name of names) assert.equal(permissions.find((p) => p.objectMetadataId === name).canReadObjectRecords, false);
});
test('readable fields exclude emails, phones and searchVector on the server', () => {
  const fields = ['name', 'city', 'emails', 'phones', 'searchVector'].map((name) => ({ id: name, name }));
  const denied = privateFieldPermissions(objects[0], fields);
  const readable = fields.filter((f) => !denied.some((p) => p.fieldMetadataId === f.id && p.canReadFieldValue === false));
  assert.deepEqual(readable.map((f) => f.name), ['name', 'city']);
});
test('provisioning fails when a required private field is missing', () => {
  assert.throws(() => privateFieldPermissions(objects[0], []), /Missing required private field/);
});
test('no import, export, mailbox connection or settings flags are allowed', () => {
  assert.doesNotThrow(() => assertClosedRole(ROLE_POLICY, permissions, []));
  for (const flag of ['IMPORT_CSV', 'EXPORT_CSV', 'CONNECTED_ACCOUNTS', 'WORKSPACE']) {
    assert.throws(() => assertClosedRole(ROLE_POLICY, permissions, [flag]), /tool or settings/);
  }
});
test('a role accidentally widened to People is rejected', () => {
  assert.throws(() => assertClosedRole(ROLE_POLICY, [{ ...permissions[0], canReadObjectRecords: true }], []), /record access/);
  assert.throws(() => assertClosedRole({ ...ROLE_POLICY, canReadAllObjectRecords: true }, permissions, []), /Unexpected role permission/);
});
