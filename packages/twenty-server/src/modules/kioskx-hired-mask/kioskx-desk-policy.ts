export const KIOSKX_DESK_WORKSPACE = '243e9c93-f7f9-47cc-ab7d-6a7dd6659774';
export const KIOSKX_DESK_ROLE_ID = '15d0420a-c8aa-49a8-8ab1-1acd4eda31e7';
export const KIOSKX_DESK_ROLE = 'KioskX Inbound Desk';

// System objects cannot be denied with upsertObjectPermissions. Apply the desk's
// deny at the common ORM permission boundary used by GraphQL and REST, after
// Twenty's system-object default. No Enterprise/row-level checks are changed.
export const isKioskxDeskRawObject = (
  workspaceId: string,
  roleId: string,
  objectName: string,
): boolean =>
  workspaceId === KIOSKX_DESK_WORKSPACE &&
  roleId === KIOSKX_DESK_ROLE_ID &&
  [
    'note',
    'noteTarget',
    'timelineActivity',
    'message',
    'messageThread',
    'messageParticipant',
    'messageChannelMessageAssociation',
    'messageAttachment',
    'attachment',
    'blocklist',
    'callRecording',
    'messageCampaign',
    'messageList',
    'messageListMember',
    'messageChannelMessageAssociationMessageFolder',
    'calendarChannelEventAssociation',
    'calendarEvent',
    'calendarEventParticipant',
    'task',
    'taskTarget',
    'workflow',
    'workflowRun',
    'workflowVersion',
    'workflowAutomatedTrigger',
    'kioskxInboundLead',
  ].includes(objectName);
