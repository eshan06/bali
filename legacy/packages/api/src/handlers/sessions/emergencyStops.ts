import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, sessionQueries, emergencyStopQueries } from '@bali/db';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';

// GET /api/sessions/:sessionId/emergency-stops — teacher: the durable log of
// student-initiated Emergency Stops for this session, newest first. Feeds the
// session-detail timeline. Mirrors the device-status getHandler auth/ownership.
export async function getHandler(
  event: APIGatewayProxyEventV2,
  user: AuthUser,
  params: Record<string, string>
) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session || session.teacherId !== teacher.id) return notFound('Session not found');

  const stops = await emergencyStopQueries.getBySession(params.sessionId);
  return json({ stops });
}
