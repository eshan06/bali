import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, sessionQueries, deviceBlockingStatusQueries } from '@bali/db';
import { setDeviceBlockingStatusSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

// GET /api/sessions/:sessionId/device-status — teacher gets all students' blocking status
export async function getHandler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session || session.teacherId !== teacher.id) return notFound('Session not found');

  const statuses = await deviceBlockingStatusQueries.getBySession(params.sessionId);
  return json({ statuses });
}

// PUT /api/sessions/:sessionId/device-status/:studentId — teacher manually sets blocking status
export async function setHandler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, setDeviceBlockingStatusSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session || session.teacherId !== teacher.id) return notFound('Session not found');

  const status = await deviceBlockingStatusQueries.setStatus(
    params.sessionId,
    params.studentId,
    parsed.data!.isBlocked,
    'manual'
  );
  return json(status);
}

// POST /api/sessions/:sessionId/device-status/:studentId/report — iOS app reports blocking status
export async function reportHandler(event: APIGatewayProxyEventV2, _user: null, params: Record<string, string>) {
  const parsed = parseBody(event, setDeviceBlockingStatusSchema);
  if (parsed.error) return error(parsed.error);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session) return notFound('Session not found');

  const status = await deviceBlockingStatusQueries.setStatus(
    params.sessionId,
    params.studentId,
    parsed.data!.isBlocked,
    'device'
  );
  return json(status);
}
