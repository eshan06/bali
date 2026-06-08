import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { studentQueries, deviceBlockingStatusQueries, query } from '@bali/db';
import { setDeviceBlockingStatusSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound, conflict } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

/**
 * The student app reports whether Focus shields are currently applied on the
 * device, so the teacher console shows live per-student blocking status
 * ("Blocking applied") instead of "status not reported". Mirrors emergencyStop's
 * student/session resolution and writes device_blocking_status with
 * reported_by='device'.
 *
 * The app reports `true` when it applies shields; it intentionally does NOT
 * report `false` on a teardown caused by Emergency Stop (that path writes the
 * more specific 'student_override'), so a normal report never clobbers an
 * Emergency Stop badge. Re-engaging re-applies shields and re-reports `true`.
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

  const parsed = parseBody(event, setDeviceBlockingStatusSchema);
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

  const status = await deviceBlockingStatusQueries.setStatus(
    sessions[0].id,
    student.id,
    parsed.data!.isBlocked,
    'device'
  );

  return json({ success: true, status });
}
