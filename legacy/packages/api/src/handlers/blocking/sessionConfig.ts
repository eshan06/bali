import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, sessionQueries } from '@bali/db';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound, conflict } from '../../lib/response';

/**
 * GET /api/sessions/:sessionId/blocking-config
 * Returns the immutable snapshot captured when the session started.
 */
export async function getHandler(_event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session || session.teacherId !== teacher.id) return notFound('Session not found');

  return json({
    sessionId: session.id,
    classId: session.classId,
    blockingMode: session.blockingMode,
    blockingEnabled: session.blockingEnabled,
    snapshot: session.blockingConfigSnapshot ?? null,
  });
}

/**
 * Mid-session config edits are intentionally locked.
 * Teachers should edit the class-level policy (which only affects future
 * sessions) so an in-flight session never sees its policy mutate.
 */
export async function setHandler(_event: APIGatewayProxyEventV2, _user: AuthUser, _params: Record<string, string>) {
  return conflict(
    'Blocking policy is locked once a session starts. Edit the policy on the class detail page; it will apply the next time you start a session.'
  );
}
