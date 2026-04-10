import { query } from '../client';

export async function getBySession(sessionId: string) {
  return query(
    `SELECT dbs.student_id as "studentId", dbs.is_blocked as "isBlocked",
            dbs.reported_at as "reportedAt", dbs.reported_by as "reportedBy"
     FROM device_blocking_status dbs
     WHERE dbs.session_id = $1`,
    [sessionId]
  );
}

export async function setStatus(
  sessionId: string,
  studentId: string,
  isBlocked: boolean,
  reportedBy: 'manual' | 'device' = 'manual'
) {
  const rows = await query(
    `INSERT INTO device_blocking_status (session_id, student_id, is_blocked, reported_at, reported_by)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (session_id, student_id)
     DO UPDATE SET is_blocked = $3, reported_at = NOW(), reported_by = $4
     RETURNING student_id as "studentId", is_blocked as "isBlocked",
               reported_at as "reportedAt", reported_by as "reportedBy"`,
    [sessionId, studentId, isBlocked, reportedBy]
  );
  return rows[0];
}

export async function clearForSession(sessionId: string) {
  await query(`DELETE FROM device_blocking_status WHERE session_id = $1`, [sessionId]);
}
