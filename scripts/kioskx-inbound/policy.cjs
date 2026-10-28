// A closed role is intentional while the live row-permission prerequisite fails.
// Do not grant People read access based on a client-side view filter.
const WORKSPACE_ID = '243e9c93-f7f9-47cc-ab7d-6a7dd6659774';
const ROLE_LABEL = 'KioskX Inbound Desk';
const CONTACT_SOURCE = 'KioskX contact form';
const ROLE_POLICY = Object.freeze({
  label: ROLE_LABEL,
  description: 'Inbound desk provisioning; closed until server row isolation and browser acceptance pass.',
  canUpdateAllSettings: false,
  canAccessAllTools: false,
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canBeAssignedToUsers: true,
  canBeAssignedToAgents: false,
  canBeAssignedToApiKeys: false,
});
const PRIVATE_PERSON_FIELDS = Object.freeze(['emails', 'phones', 'searchVector']);

function closedObjectPermissions(objects) {
  return objects.filter((object) => !object.isSystem).map((object) => ({
    objectMetadataId: object.id,
    canReadObjectRecords: false,
    canUpdateObjectRecords: false,
    canSoftDeleteObjectRecords: false,
    canDestroyObjectRecords: false,
  }));
}

function privateFieldPermissions(person, fields) {
  return PRIVATE_PERSON_FIELDS.map((name) => {
    const field = fields.find((field) => field.name === name);
    if (!field) throw new Error(`Missing required private field: ${name}`);
    return {
      objectMetadataId: person.id,
      fieldMetadataId: field.id,
      canReadFieldValue: false,
      canUpdateFieldValue: false,
    };
  });
}

function assertClosedRole(role, permissions, flags) {
  for (const key of Object.keys(ROLE_POLICY).filter((key) => key.startsWith('can'))) {
    if (role[key] !== ROLE_POLICY[key]) throw new Error(`Unexpected role permission: ${key}`);
  }
  if (flags.length) throw new Error('Closed role has tool or settings permissions');
  if (permissions.some((p) => p.canReadObjectRecords || p.canUpdateObjectRecords ||
    p.canSoftDeleteObjectRecords || p.canDestroyObjectRecords)) {
    throw new Error('Closed role has record access');
  }
}

module.exports = { WORKSPACE_ID, ROLE_LABEL, CONTACT_SOURCE, ROLE_POLICY,
  PRIVATE_PERSON_FIELDS, closedObjectPermissions, privateFieldPermissions, assertClosedRole };
