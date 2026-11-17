export const HIRED_WORKSPACE = '243e9c93-f7f9-47cc-ab7d-6a7dd6659774';
export type DeskIdentity = {
  user?: { email: string } | null;
  workspace?: { id: string };
};
export const isHiredDesk = (identity: DeskIdentity) =>
  identity.workspace?.id === HIRED_WORKSPACE &&
  identity.user?.email.toLowerCase() === 'support@kiosk-x.ai';

// Applied after token verification, independent of host, client routes and role grants.
export const hiredRequestAllowed = (
  identity: DeskIdentity,
  request: { method: string; originalUrl?: string; url?: string },
) => {
  if (!isHiredDesk(identity)) return true;
  let path: string;
  try {
    path = new URL(
      request.originalUrl ?? request.url ?? '',
      'http://desk.local',
    ).pathname;
  } catch {
    return false;
  }
  return (
    (request.method === 'GET' &&
      [
        '/kioskx-hired-desk/calendar',
        '/kioskx-hired-desk/applications',
        '/kioskx-hired-desk/application-resume',
        '/kioskx-hired-desk/voice-session',
        '/kioskx-hired-desk/crew-jobs',
        '/kioskx-hired-desk/company-mail',
        '/kioskx-hired-desk/company-engagement',
        '/kioskx-hired-desk/session',
        '/kioskx-hired-desk/queues',
        '/kioskx-hired-desk/leads',
        '/kioskx-hired-desk/voice-config',
      ].includes(path)) ||
    (request.method === 'POST' &&
      [
        '/kioskx-hired-desk/calendar',
        '/kioskx-hired-desk/crew-assign',
        '/kioskx-hired-desk/company-reply',
        '/kioskx-hired-desk/company-send',
        '/kioskx-hired-desk/company-site',
        '/kioskx-hired-desk/notes',
        '/kioskx-hired-desk/queue-work',
        '/kioskx-hired-desk/queue-send',
        '/kioskx-hired-desk/call',
        '/kioskx-hired-desk/voice-bridge',
        '/kioskx-hired-desk/email',
        '/kioskx-hired-desk/activity',
      ].includes(path))
  );
};
