import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { studentQueries, attendanceQueries, deviceBlockingStatusQueries, query } from '@bali/db';
import {
  ATTENDANCE_LATE_AFTER_MINUTES,
  INACTIVE_BLOCKING_SNAPSHOT,
  type BlockingSnapshot,
} from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound, conflict } from '../../lib/response';

/**
 * Student-side prototype check-in. Skips the hardware tap and writes the
 * attendance record directly. Mimics the future iOS app's first run.
 */
export async function handler(
  _event: APIGatewayProxyEventV2,
  user: AuthUser,
  params: Record<string, string>
) {
  if (user.role !== 'student') return error('Student role required', 403);

  const student = await studentQueries.findByCognitoSub(user.sub);
  if (!student) return notFound('Profile not created');

  const enrollment = await studentQueries.getEnrollment(
    params.classId,
    student.id
  );
  if (!enrollment) return notFound('Class not found');

  const sessions = await query<{
    id: string;
    startedAt: string;
    thresholdMinutes: number;
    blockingConfigSnapshot: BlockingSnapshot | null;
  }>(
    `SELECT cs.id, cs.started_at as "startedAt",
            cs.attendance_threshold_minutes as "thresholdMinutes",
            cs.blocking_config_snapshot as "blockingConfigSnapshot"
     FROM class_sessions cs
     WHERE cs.class_id = $1 AND cs.ended_at IS NULL
     ORDER BY cs.started_at DESC
     LIMIT 1`,
    [params.classId]
  );

  if (sessions.length === 0) {
    return conflict('No active session for this class right now.');
  }

  const session = sessions[0];
  const now = new Date();
  const tapTimestamp = now.toISOString();

  const minutesSinceStart =
    (now.getTime() - new Date(session.startedAt).getTime()) / 60000;
  const lateAfter =
    session.thresholdMinutes || ATTENDANCE_LATE_AFTER_MINUTES;
  const status: 'present' | 'late' =
    minutesSinceStart <= lateAfter ? 'present' : 'late';

  // Synthetic device id so this looks distinct in the raw check_ins log.
  const syntheticDeviceId = `web_simulate_${student.id}`;

  await query(
    `INSERT INTO check_ins (session_id, device_id, student_id, tap_timestamp)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id, device_id, tap_timestamp) DO NOTHING`,
    [session.id, syntheticDeviceId, student.id, tapTimestamp]
  );

  await attendanceQueries.upsertFromCheckIn(
    session.id,
    student.id,
    status,
    tapTimestamp
  );

  // Mimic the iOS app reporting that the policy was applied. Without this the
  // student page sits at "Blocking pending" forever in the no-hardware flow.
  if (session.blockingConfigSnapshot?.blockingActive) {
    await deviceBlockingStatusQueries.setStatus(
      session.id,
      student.id,
      true,
      'device'
    );
  }

  return json({
    success: true,
    sessionId: session.id,
    classId: params.classId,
    attendanceStatus: status,
    checkInTime: tapTimestamp,
    blockingPolicy:
      session.blockingConfigSnapshot ?? INACTIVE_BLOCKING_SNAPSHOT,
  });
}
