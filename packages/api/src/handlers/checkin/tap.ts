import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { deviceQueries, attendanceQueries, query } from '@bali/db';
import {
  checkInSchema,
  ATTENDANCE_LATE_AFTER_MINUTES,
  CHECK_IN_ERROR_CODE,
  INACTIVE_BLOCKING_SNAPSHOT,
  type BlockingSnapshot,
} from '@bali/shared';
import { json } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

/**
 * Hardware tap → check-in. Auth: x-api-key.
 * Implements the contract in `docs/`-style brief: success returns the blocking
 * policy so the device can confirm the student should be entering focus mode.
 */
export async function handler(event: APIGatewayProxyEventV2) {
  const parsed = parseBody(event, checkInSchema);
  if (parsed.error) {
    return failure(400, CHECK_IN_ERROR_CODE.INVALID_REQUEST, parsed.error);
  }

  const { deviceId, timestamp } = parsed.data!;

  // 1. Look up device
  const device = await deviceQueries.findByDeviceId(deviceId);
  if (!device) {
    return failure(
      404,
      CHECK_IN_ERROR_CODE.UNKNOWN_DEVICE,
      'This device is not registered.'
    );
  }
  if (!device.studentId) {
    return failure(
      409,
      CHECK_IN_ERROR_CODE.UNASSIGNED_DEVICE,
      'This device is not assigned to a student.'
    );
  }

  // 2. Find active session for this student. If they're enrolled in multiple
  // classes that all happen to have an active session, that's ambiguous —
  // we surface it instead of silently picking one.
  const sessions = await query<{
    id: string;
    classId: string;
    startedAt: string;
    thresholdMinutes: number;
    blockingConfigSnapshot: BlockingSnapshot | null;
  }>(
    `SELECT cs.id, cs.class_id as "classId", cs.started_at as "startedAt",
            cs.attendance_threshold_minutes as "thresholdMinutes",
            cs.blocking_config_snapshot as "blockingConfigSnapshot"
     FROM class_sessions cs
     JOIN class_students cst ON cst.class_id = cs.class_id
     WHERE cst.student_id = $1 AND cs.ended_at IS NULL
     ORDER BY cs.started_at DESC`,
    [device.studentId]
  );

  if (sessions.length === 0) {
    return failure(
      404,
      CHECK_IN_ERROR_CODE.NO_ACTIVE_SESSION,
      'No active class session found for this device.'
    );
  }
  if (sessions.length > 1) {
    return failure(
      409,
      CHECK_IN_ERROR_CODE.AMBIGUOUS_SESSION,
      'Student is enrolled in more than one active session.'
    );
  }

  const session = sessions[0];

  // 3. Insert check-in (deduped on (session_id, device_id, tap_timestamp))
  await query(
    `INSERT INTO check_ins (session_id, device_id, student_id, tap_timestamp)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id, device_id, tap_timestamp) DO NOTHING`,
    [session.id, deviceId, device.studentId, timestamp]
  );

  // 4. Determine attendance status from time-since-session-start.
  const tapTime = new Date(timestamp).getTime();
  const sessionStart = new Date(session.startedAt).getTime();
  const minutesSinceStart = (tapTime - sessionStart) / 60000;
  const lateAfter = session.thresholdMinutes || ATTENDANCE_LATE_AFTER_MINUTES;
  const status: 'present' | 'late' = minutesSinceStart <= lateAfter ? 'present' : 'late';

  await attendanceQueries.upsertFromCheckIn(session.id, device.studentId, status, timestamp);

  return json({
    success: true,
    deviceId,
    studentId: device.studentId,
    studentName: device.studentName ?? null,
    sessionId: session.id,
    classId: session.classId,
    attendanceStatus: status,
    checkInTime: timestamp,
    blockingPolicy: session.blockingConfigSnapshot ?? INACTIVE_BLOCKING_SNAPSHOT,
  });
}

function failure(httpStatus: number, code: string, message: string) {
  return json(
    { success: false, error: code, message },
    httpStatus
  );
}
