import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { deviceQueries, attendanceQueries, query } from '@bali/db';
import { checkInSchema, ATTENDANCE_THRESHOLD_MINUTES } from '@bali/shared';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function handler(event: APIGatewayProxyEventV2) {
  const parsed = parseBody(event, checkInSchema);
  if (parsed.error) return error(parsed.error);

  const { deviceId, timestamp } = parsed.data!;

  // 1. Look up device → student
  const device = await deviceQueries.findByDeviceId(deviceId);
  if (!device) return notFound('Device not registered');
  if (!device.studentId) return error('Device not assigned to a student');

  // 2. Find active session for this student
  const sessions = await query(
    `SELECT cs.id, cs.class_id as "classId", cs.started_at as "startedAt",
            cs.attendance_threshold_minutes as "thresholdMinutes"
     FROM class_sessions cs
     JOIN class_students cst ON cst.class_id = cs.class_id
     WHERE cst.student_id = $1 AND cs.ended_at IS NULL
     ORDER BY cs.started_at DESC LIMIT 1`,
    [device.studentId]
  );

  if (sessions.length === 0) {
    return json({ status: 'no_active_session' });
  }

  const session = sessions[0];

  // 3. Insert check-in (with dedup)
  await query(
    `INSERT INTO check_ins (session_id, device_id, student_id, tap_timestamp)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id, device_id, tap_timestamp) DO NOTHING`,
    [session.id, deviceId, device.studentId, timestamp]
  );

  // 4. Determine attendance status
  const tapTime = new Date(timestamp).getTime();
  const sessionStart = new Date(session.startedAt).getTime();
  const minutesSinceStart = (tapTime - sessionStart) / 60000;
  const threshold = session.thresholdMinutes || ATTENDANCE_THRESHOLD_MINUTES;
  const status = minutesSinceStart <= threshold ? 'present' : 'late';

  // 5. Upsert attendance record
  await attendanceQueries.upsertFromCheckIn(session.id, device.studentId, status, timestamp);

  return json({ status: 'ok', studentName: device.studentName || undefined });
}
