"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get HIRED_WORKSPACE () {
        return HIRED_WORKSPACE;
    },
    get hiredRequestAllowed () {
        return hiredRequestAllowed;
    },
    get isHiredDesk () {
        return isHiredDesk;
    }
});
const HIRED_WORKSPACE = '243e9c93-f7f9-47cc-ab7d-6a7dd6659774';
const isHiredDesk = (identity)=>identity.workspace?.id === HIRED_WORKSPACE && identity.user?.email.toLowerCase() === 'support@kiosk-x.ai';
const hiredRequestAllowed = (identity, request)=>{
    if (!isHiredDesk(identity)) return true;
    let path;
    try {
        path = new URL(request.originalUrl ?? request.url ?? '', 'http://desk.local').pathname;
    } catch  {
        return false;
    }
    return request.method === 'GET' && [
        '/kioskx-hired-desk/session', '/kioskx-hired-desk/queues',
        '/kioskx-hired-desk/leads', '/kioskx-hired-desk/voice-config'
    ].includes(path) || request.method === 'POST' && [
        '/kioskx-hired-desk/notes', '/kioskx-hired-desk/queue-work', '/kioskx-hired-desk/queue-send',
        '/kioskx-hired-desk/call', '/kioskx-hired-desk/voice-bridge',
        '/kioskx-hired-desk/email',
        '/kioskx-hired-desk/activity'
    ].includes(path);
};
