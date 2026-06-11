import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, sessionQueries, studentQueries } from '@bali/db';
import { toggleBlockingSchema, INACTIVE_BLOCKING_SNAPSHOT, type BlockingSnapshot } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';
import { sendBlockingSignal } from '../../services/pushNotification';

/**
 * PUT /api/sessions/:sessionId/blocking
 * Toggles whether the session's locked snapshot is currently being enforced
 * on student devices. The policy itself is immutable for the session — any
 * `appIds` / `blockingMode` overrides in the body are ignored.
 */
export async function handler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, toggleBlockingSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findById(params.sessionId);
  if (!session || session.teacherId !== teacher.id) return notFound('Session not found');

  const snapshot: BlockingSnapshot = session.blockingConfigSnapshot ?? INACTIVE_BLOCKING_SNAPSHOT;
  const enabled = parsed.data!.enabled;

  await sessionQueries.setBlocking(params.sessionId, enabled, snapshot.mode);

  const students = await studentQueries.findByClass(session.classId);
  const studentIds = students.map((s: any) => s.id);

  await sendBlockingSignal({
    sessionId: params.sessionId,
    studentIds,
    blockingEnabled: enabled,
    blockingMode: snapshot.mode,
    blockedApps: enabled ? snapshot.blockedApps.map((a) => a.bundleId) : [],
    allowedApps: enabled ? snapshot.allowedApps.map((a) => a.bundleId) : [],
  });

  return json({
    sessionId: params.sessionId,
    blockingEnabled: enabled,
    blockingMode: snapshot.mode,
    snapshot,
  });
}
