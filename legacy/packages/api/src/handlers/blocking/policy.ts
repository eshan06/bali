import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { blockingQueries, query } from '@bali/db';
import { INACTIVE_BLOCKING_SNAPSHOT, type BlockingSnapshot } from '@bali/shared';
import { json } from '../../lib/response';

/**
 * GET /api/blocking/policy/:studentId — used by the iOS app / simulator to
 * fetch the current focus-mode policy. Auth: x-api-key.
 *
 * Reads the `blocking_config_snapshot` JSONB stored on the student's active
 * session (immutable for the duration of the session). Falls back to the
 * legacy resolver if the snapshot is missing — meaning the session was
 * started before the snapshot column existed.
 */
export async function handler(
  _event: APIGatewayProxyEventV2,
  _user: null,
  params: Record<string, string>
) {
  const studentId = params.studentId;

  const sessions = await query<{
    sessionId: string;
    classId: string;
    snapshot: BlockingSnapshot | null;
  }>(
    `SELECT cs.id as "sessionId", cs.class_id as "classId",
            cs.blocking_config_snapshot as "snapshot"
     FROM class_sessions cs
     JOIN class_students cst ON cst.class_id = cs.class_id
     WHERE cst.student_id = $1 AND cs.ended_at IS NULL
     ORDER BY cs.started_at DESC LIMIT 1`,
    [studentId]
  );

  if (sessions.length === 0) {
    return json({
      ...INACTIVE_BLOCKING_SNAPSHOT,
      classId: null,
      sessionId: null,
      message: 'No active session.',
    });
  }

  const { sessionId, classId, snapshot } = sessions[0];

  if (snapshot) {
    return json({
      blockingActive: snapshot.blockingActive,
      mode: snapshot.preset,
      classId,
      sessionId,
      blockedApps: snapshot.blockedApps,
      allowedApps: snapshot.allowedApps,
    });
  }

  // Legacy fallback: re-resolve from class config. Only hit by sessions
  // started before migration 011.
  const legacy = await blockingQueries.getPolicyForStudent(studentId);
  return json({
    blockingActive: legacy.blocking,
    mode: null,
    classId,
    sessionId,
    blockedApps: legacy.blockedApps.map((bundleId: string) => ({
      bundleId,
      appName: bundleId,
    })),
    allowedApps: legacy.allowedApps.map((bundleId: string) => ({
      bundleId,
      appName: bundleId,
    })),
  });
}
