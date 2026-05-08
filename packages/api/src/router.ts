import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { authenticateJwt, authenticateApiKey, AuthUser } from './middleware/auth';
import { json, error, unauthorized, notFound, corsResponse } from './lib/response';

// Handler imports
import { handler as authMe } from './handlers/auth/me';
import { handler as classCreate } from './handlers/classes/create';
import { handler as classList } from './handlers/classes/list';
import { handler as classGet } from './handlers/classes/get';
import { handler as classUpdate } from './handlers/classes/update';
import { handler as classDelete } from './handlers/classes/delete';
import { handler as classPreview } from './handlers/classes/preview';
import { handler as classJoin } from './handlers/classes/join';
import { getHandler as studentMeGet, postHandler as studentMePost } from './handlers/students/me';
import { handler as studentClassDetail } from './handlers/students/classDetail';
import { handler as studentSimulateCheckIn } from './handlers/students/simulateCheckIn';
import { handler as inviteCreate } from './handlers/invites/create';
import { handler as inviteList } from './handlers/invites/list';
import { handler as inviteRevoke } from './handlers/invites/revoke';
import { handler as inviteAccept } from './handlers/invites/accept';
import { handler as studentAdd } from './handlers/students/add';
import { handler as studentBulkAdd } from './handlers/students/bulkAdd';
import { handler as studentList } from './handlers/students/list';
import { handler as studentRemove } from './handlers/students/remove';
import { handler as studentProfile } from './handlers/students/profile';
import { handler as studentUpdateNotes } from './handlers/students/updateNotes';
import { handler as sessionStart } from './handlers/sessions/start';
import { handler as sessionEnd } from './handlers/sessions/end';
import { handler as sessionActive } from './handlers/sessions/active';
import { handler as sessionList } from './handlers/sessions/list';
import { handler as sessionGet } from './handlers/sessions/get';
import { handler as checkinTap } from './handlers/checkin/tap';
import { handler as attendanceStatus } from './handlers/attendance/status';
import { handler as attendanceOverride } from './handlers/attendance/override';
import { handler as attendanceHistory } from './handlers/attendance/history';
import { handler as deviceRegister } from './handlers/devices/register';
import { handler as deviceAssign } from './handlers/devices/assign';
import { handler as deviceUnassign } from './handlers/devices/unassign';
import { handler as deviceList } from './handlers/devices/list';
import { handler as blockingToggle } from './handlers/blocking/toggle';
import { handler as blockingPolicy } from './handlers/blocking/policy';
import { listHandler as blockingAppsList, addHandler as blockingAppsAdd, removeHandler as blockingAppsRemove } from './handlers/blocking/apps';
import { getHandler as sessionBlocklistGet, setHandler as sessionBlocklistSet } from './handlers/blocking/sessionBlocklist';
import { getHandler as deviceStatusGet, setHandler as deviceStatusSet, reportHandler as deviceStatusReport } from './handlers/blocking/deviceStatus';
import { listHandler as teacherAppsList, addHandler as teacherAppsAdd, removeHandler as teacherAppsRemove } from './handlers/blocking/teacherApps';
import { getHandler as teacherDefaultsGet, saveHandler as teacherDefaultsSave } from './handlers/blocking/teacherDefaults';
import { getHandler as sessionConfigGet, setHandler as sessionConfigSet } from './handlers/blocking/sessionConfig';
import { getHandler as classBlockingConfigGet, setHandler as classBlockingConfigSet } from './handlers/blocking/classConfig';

type HandlerFn = (event: APIGatewayProxyEventV2, user: any, params: Record<string, string>) => Promise<APIGatewayProxyResultV2>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: HandlerFn;
  auth: 'jwt' | 'apikey' | 'none';
}

const routes: Route[] = [
  // Auth
  { method: 'GET',    pattern: /^\/api\/auth\/me$/,                                                    handler: authMe,              auth: 'jwt' },

  // Classes
  { method: 'POST',   pattern: /^\/api\/classes$/,                                                     handler: classCreate,         auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/classes$/,                                                      handler: classList,           auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/classes\/(?<classId>[^/]+)$/,                                   handler: classGet,            auth: 'jwt' },
  { method: 'PUT',    pattern: /^\/api\/classes\/(?<classId>[^/]+)$/,                                   handler: classUpdate,         auth: 'jwt' },
  { method: 'DELETE', pattern: /^\/api\/classes\/(?<classId>[^/]+)$/,                                   handler: classDelete,         auth: 'jwt' },

  // Class invite (student-side join via classId-as-token)
  { method: 'GET',    pattern: /^\/api\/classes\/(?<classId>[^/]+)\/preview$/,                          handler: classPreview,        auth: 'jwt' },
  { method: 'POST',   pattern: /^\/api\/classes\/(?<classId>[^/]+)\/join$/,                             handler: classJoin,           auth: 'jwt' },

  // Student self-service
  { method: 'GET',    pattern: /^\/api\/students\/me$/,                                                 handler: studentMeGet,        auth: 'jwt' },
  { method: 'POST',   pattern: /^\/api\/students\/me$/,                                                 handler: studentMePost,       auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/students\/me\/classes\/(?<classId>[^/]+)$/,                     handler: studentClassDetail,  auth: 'jwt' },
  { method: 'POST',   pattern: /^\/api\/students\/me\/classes\/(?<classId>[^/]+)\/simulate-check-in$/,  handler: studentSimulateCheckIn, auth: 'jwt' },

  // Class invites by email (teacher manages, student accepts)
  { method: 'POST',   pattern: /^\/api\/classes\/(?<classId>[^/]+)\/invites$/,                          handler: inviteCreate,        auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/classes\/(?<classId>[^/]+)\/invites$/,                          handler: inviteList,          auth: 'jwt' },
  { method: 'DELETE', pattern: /^\/api\/classes\/(?<classId>[^/]+)\/invites\/(?<inviteId>[^/]+)$/,      handler: inviteRevoke,        auth: 'jwt' },
  { method: 'POST',   pattern: /^\/api\/invites\/(?<inviteId>[^/]+)\/accept$/,                          handler: inviteAccept,        auth: 'jwt' },

  // Students
  { method: 'POST',   pattern: /^\/api\/classes\/(?<classId>[^/]+)\/students$/,                         handler: studentAdd,          auth: 'jwt' },
  { method: 'POST',   pattern: /^\/api\/classes\/(?<classId>[^/]+)\/students\/import$/,                 handler: studentBulkAdd,      auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/classes\/(?<classId>[^/]+)\/students$/,                          handler: studentList,         auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/classes\/(?<classId>[^/]+)\/students\/(?<studentId>[^/]+)$/,     handler: studentProfile,      auth: 'jwt' },
  { method: 'PUT',    pattern: /^\/api\/classes\/(?<classId>[^/]+)\/students\/(?<studentId>[^/]+)\/notes$/, handler: studentUpdateNotes, auth: 'jwt' },
  { method: 'DELETE', pattern: /^\/api\/classes\/(?<classId>[^/]+)\/students\/(?<studentId>[^/]+)$/,     handler: studentRemove,       auth: 'jwt' },

  // Sessions
  { method: 'POST',   pattern: /^\/api\/sessions\/start$/,                                             handler: sessionStart,        auth: 'jwt' },
  { method: 'POST',   pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/end$/,                           handler: sessionEnd,          auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/sessions\/active$/,                                             handler: sessionActive,       auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/classes\/(?<classId>[^/]+)\/sessions$/,                          handler: sessionList,         auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)$/,                                handler: sessionGet,          auth: 'jwt' },

  // Check-in (API key auth for hardware devices)
  { method: 'POST',   pattern: /^\/api\/checkin$/,                                                     handler: checkinTap,          auth: 'apikey' },

  // Attendance
  { method: 'GET',    pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/attendance$/,                    handler: attendanceStatus,    auth: 'jwt' },
  { method: 'PUT',    pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/attendance\/(?<studentId>[^/]+)$/,handler: attendanceOverride,  auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/classes\/(?<classId>[^/]+)\/attendance\/history$/,               handler: attendanceHistory,   auth: 'jwt' },

  // Devices
  { method: 'POST',   pattern: /^\/api\/devices$/,                                                     handler: deviceRegister,      auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/devices$/,                                                      handler: deviceList,          auth: 'jwt' },
  { method: 'PUT',    pattern: /^\/api\/devices\/(?<deviceId>[^/]+)\/assign$/,                          handler: deviceAssign,        auth: 'jwt' },
  { method: 'PUT',    pattern: /^\/api\/devices\/(?<deviceId>[^/]+)\/unassign$/,                        handler: deviceUnassign,      auth: 'jwt' },

  // Blocking
  { method: 'PUT',    pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/blocking$/,                      handler: blockingToggle,      auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/blocking\/policy\/(?<studentId>[^/]+)$/,                        handler: blockingPolicy,      auth: 'apikey' },
  { method: 'GET',    pattern: /^\/api\/blocking\/apps$/,                                               handler: blockingAppsList,    auth: 'jwt' },
  { method: 'POST',   pattern: /^\/api\/blocking\/apps$/,                                               handler: blockingAppsAdd,     auth: 'jwt' },
  { method: 'DELETE', pattern: /^\/api\/blocking\/apps\/(?<appId>[^/]+)$/,                              handler: blockingAppsRemove,  auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/blocklist$/,                     handler: sessionBlocklistGet, auth: 'jwt' },
  { method: 'PUT',    pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/blocklist$/,                     handler: sessionBlocklistSet, auth: 'jwt' },

  // Class blocking config
  { method: 'GET',    pattern: /^\/api\/classes\/(?<classId>[^/]+)\/blocking-config$/,                  handler: classBlockingConfigGet,  auth: 'jwt' },
  { method: 'PUT',    pattern: /^\/api\/classes\/(?<classId>[^/]+)\/blocking-config$/,                  handler: classBlockingConfigSet,  auth: 'jwt' },

  // Teacher app catalog
  { method: 'GET',    pattern: /^\/api\/blocking\/teacher-apps$/,                                       handler: teacherAppsList,     auth: 'jwt' },
  { method: 'POST',   pattern: /^\/api\/blocking\/teacher-apps$/,                                       handler: teacherAppsAdd,      auth: 'jwt' },
  { method: 'DELETE', pattern: /^\/api\/blocking\/teacher-apps\/(?<appId>[^/]+)$/,                      handler: teacherAppsRemove,   auth: 'jwt' },

  // Teacher blocking defaults
  { method: 'GET',    pattern: /^\/api\/blocking\/defaults$/,                                           handler: teacherDefaultsGet,  auth: 'jwt' },
  { method: 'PUT',    pattern: /^\/api\/blocking\/defaults$/,                                           handler: teacherDefaultsSave, auth: 'jwt' },

  // Session blocking config
  { method: 'GET',    pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/blocking-config$/,               handler: sessionConfigGet,    auth: 'jwt' },
  { method: 'PUT',    pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/blocking-config$/,               handler: sessionConfigSet,    auth: 'jwt' },

  // Device blocking status (per-student)
  { method: 'GET',    pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/device-status$/,                                         handler: deviceStatusGet,     auth: 'jwt' },
  { method: 'PUT',    pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/device-status\/(?<studentId>[^/]+)$/,                    handler: deviceStatusSet,     auth: 'jwt' },
  { method: 'POST',   pattern: /^\/api\/sessions\/(?<sessionId>[^/]+)\/device-status\/(?<studentId>[^/]+)\/report$/,            handler: deviceStatusReport,  auth: 'apikey' },

  // Teacher-facing simulator: same logic as the hardware/iOS endpoints, but
  // authed with the teacher's JWT so the API key never reaches the browser.
  { method: 'POST',   pattern: /^\/api\/dev\/simulator\/check-in$/,                                                              handler: checkinTap,          auth: 'jwt' },
  { method: 'GET',    pattern: /^\/api\/dev\/simulator\/policy\/(?<studentId>[^/]+)$/,                                            handler: blockingPolicy,      auth: 'jwt' },
  { method: 'POST',   pattern: /^\/api\/dev\/simulator\/blocking-status\/(?<sessionId>[^/]+)\/(?<studentId>[^/]+)$/,              handler: deviceStatusReport,  auth: 'jwt' },
];

export async function handler(event: APIGatewayProxyEventV2, _context: Context): Promise<APIGatewayProxyResultV2> {
  // Handle CORS preflight
  if (event.requestContext.http.method === 'OPTIONS') {
    return corsResponse();
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // Find matching route
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = path.match(route.pattern);
    if (!match) continue;

    const params = match.groups || {};

    try {
      // Authenticate
      if (route.auth === 'jwt') {
        const user = await authenticateJwt(event);
        if (!user) return unauthorized();
        return await route.handler(event, user, params);
      } else if (route.auth === 'apikey') {
        if (!authenticateApiKey(event)) return unauthorized('Invalid API key');
        return await route.handler(event, null, params);
      } else {
        return await route.handler(event, null, params);
      }
    } catch (err: any) {
      console.error('Handler error:', err);
      return error(err.message || 'Internal server error', 500);
    }
  }

  return notFound(`No route matched: ${method} ${path}`);
}
