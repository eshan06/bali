import { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  studentQueries,
  deviceBlockingStatusQueries,
  emergencyStopQueries,
  query,
} from '@bali/db';
import { emergencyStopSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound, conflict } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

/**
 * Student-initiated Emergency Stop. The iOS app has already turned Focus off
 * locally (no teacher approval) — this records it: flips the student's device
 * blocking status to a `student_override` (surfaces in the teacher's existing
 * device-status view) and appends a durable note to `emergency_stop_log` so the
 * teacher console can show that the student stopped, with reason + time.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  user: AuthUser,
  params: Record<string, string>
) {
  if (user.role !== 'student') return error('Student role required', 403);

  const student = await studentQueries.findByCognitoSub(user.sub);
  if (!student) return notFound('Profile not created');

  const enrollment = await studentQueries.getEnrollment(params.classId, student.id);
  if (!enrollment) return notFound('Class not found');

  const parsed = parseBody(event, emergencyStopSchema);
  if (parsed.error) return error(parsed.error);

  const sessions = await query<{ id: string }>(
    `SELECT cs.id FROM class_sessions cs
     WHERE cs.class_id = $1 AND cs.ended_at IS NULL
     ORDER BY cs.started_at DESC
     LIMIT 1`,
    [params.classId]
  );
  if (sessions.length === 0) {
    return conflict('No active session for this class right now.');
  }
  const sessionId = sessions[0].id;

  // The teacher's existing device-status view reads this as a student override.
  await deviceBlockingStatusQueries.setStatus(sessionId, student.id, false, 'student_override');
  // Durable record (survives the student re-engaging).
  const entry = await emergencyStopQueries.log(
    sessionId,
    student.id,
    parsed.data!.reason ?? '',
    parsed.data!.note ?? ''
  );

  return json({ success: true, sessionId, loggedAt: entry.createdAt });
}
