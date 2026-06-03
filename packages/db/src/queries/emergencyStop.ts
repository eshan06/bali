import { query } from '../client';

/** Record a student-initiated Emergency Stop for a session (append-only). */
export async function log(
  sessionId: string,
  studentId: string,
  reason: string,
  note: string
) {
  const rows = await query(
    `INSERT INTO emergency_stop_log (session_id, student_id, reason, note)
     VALUES ($1, $2, $3, $4)
     RETURNING id, session_id as "sessionId", student_id as "studentId",
               reason, note, created_at as "createdAt"`,
    [sessionId, studentId, reason || null, note || null]
  );
  return rows[0];
}

/** All Emergency Stops for a session, newest first (teacher console). */
export async function getBySession(sessionId: string) {
  return query(
    `SELECT esl.id, esl.student_id as "studentId", esl.reason, esl.note,
            esl.created_at as "createdAt",
            s.first_name as "firstName", s.last_name as "lastName"
     FROM emergency_stop_log esl
     JOIN students s ON s.id = esl.student_id
     WHERE esl.session_id = $1
     ORDER BY esl.created_at DESC`,
    [sessionId]
  );
}
