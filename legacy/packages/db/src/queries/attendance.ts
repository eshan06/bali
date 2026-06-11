import { query } from '../client';

export async function getBySession(sessionId: string) {
  return query(
    `SELECT ar.id, ar.student_id as "studentId",
            s.first_name as "firstName", s.last_name as "lastName",
            ar.status, ar.check_in_at as "checkInAt",
            ar.marked_at as "markedAt",
            ar.override_by as "overrideBy",
            CASE WHEN ar.override_by IS NOT NULL THEN true ELSE false END as "isOverride"
     FROM attendance_records ar
     JOIN students s ON s.id = ar.student_id
     WHERE ar.session_id = $1
     ORDER BY s.last_name, s.first_name`,
    [sessionId]
  );
}

export async function getBySessionWithEnrolled(sessionId: string, classId: string) {
  // Returns all enrolled students with their attendance status (null if no record yet)
  return query(
    `SELECT s.id as "studentId", s.first_name as "firstName", s.last_name as "lastName",
            COALESCE(ar.status, 'pending') as status,
            ar.check_in_at as "checkInAt",
            ar.marked_at as "markedAt",
            CASE WHEN ar.override_by IS NOT NULL THEN true ELSE false END as "isOverride"
     FROM class_students cs
     JOIN students s ON s.id = cs.student_id
     LEFT JOIN attendance_records ar ON ar.session_id = $1 AND ar.student_id = s.id
     WHERE cs.class_id = $2
     ORDER BY s.last_name, s.first_name`,
    [sessionId, classId]
  );
}

export async function override(sessionId: string, studentId: string, status: string, teacherId: string) {
  // Log the old status before overwriting
  const existing = await query(
    `SELECT status FROM attendance_records WHERE session_id = $1 AND student_id = $2`,
    [sessionId, studentId]
  );
  const oldStatus = existing[0]?.status;

  const rows = await query(
    `INSERT INTO attendance_records (session_id, student_id, status, marked_at, override_by)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (session_id, student_id)
     DO UPDATE SET status = $3, marked_at = NOW(), override_by = $4
     RETURNING id, student_id as "studentId", status, marked_at as "markedAt"`,
    [sessionId, studentId, status, teacherId]
  );

  if (oldStatus && oldStatus !== status) {
    await query(
      `INSERT INTO attendance_audit_log (session_id, student_id, old_status, new_status, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, studentId, oldStatus, status, teacherId]
    );
  }

  return rows[0];
}

export async function upsertFromCheckIn(sessionId: string, studentId: string, status: string, checkInAt: string) {
  const rows = await query(
    `INSERT INTO attendance_records (session_id, student_id, status, check_in_at, marked_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (session_id, student_id)
     DO UPDATE SET
       status = CASE
         WHEN attendance_records.override_by IS NOT NULL THEN attendance_records.status
         WHEN attendance_records.check_in_at IS NULL THEN EXCLUDED.status
         ELSE attendance_records.status
       END,
       check_in_at = COALESCE(attendance_records.check_in_at, EXCLUDED.check_in_at)
     RETURNING id, status`,
    [sessionId, studentId, status, checkInAt]
  );
  return rows[0];
}

export async function markAbsentForMissing(sessionId: string, classId: string) {
  await query(
    `INSERT INTO attendance_records (session_id, student_id, status, marked_at)
     SELECT $1, cs.student_id, 'absent', NOW()
     FROM class_students cs
     WHERE cs.class_id = $2
       AND cs.student_id NOT IN (
         SELECT student_id FROM attendance_records WHERE session_id = $1
       )
     ON CONFLICT (session_id, student_id) DO NOTHING`,
    [sessionId, classId]
  );
}

export async function getAuditLog(sessionId: string, studentId: string) {
  return query(
    `SELECT aal.old_status as "oldStatus", aal.new_status as "newStatus",
            aal.changed_at as "changedAt",
            t.display_name as "changedByName"
     FROM attendance_audit_log aal
     LEFT JOIN teachers t ON t.id = aal.changed_by
     WHERE aal.session_id = $1 AND aal.student_id = $2
     ORDER BY aal.changed_at ASC`,
    [sessionId, studentId]
  );
}

export async function getAuditLogForStudentInClass(studentId: string, classId: string) {
  return query(
    `SELECT aal.session_id as "sessionId", aal.old_status as "oldStatus",
            aal.new_status as "newStatus", aal.changed_at as "changedAt",
            t.display_name as "changedByName"
     FROM attendance_audit_log aal
     JOIN class_sessions cs ON cs.id = aal.session_id
     LEFT JOIN teachers t ON t.id = aal.changed_by
     WHERE aal.student_id = $1 AND cs.class_id = $2
     ORDER BY aal.changed_at ASC`,
    [studentId, classId]
  );
}

export async function getHistoryByClass(classId: string, limit = 20, offset = 0) {
  return query(
    `SELECT cs.id as "sessionId", cs.started_at as "startedAt", cs.ended_at as "endedAt",
            COUNT(CASE WHEN ar.status = 'present' THEN 1 END)::int as "presentCount",
            COUNT(CASE WHEN ar.status = 'late' THEN 1 END)::int as "lateCount",
            COUNT(CASE WHEN ar.status = 'absent' THEN 1 END)::int as "absentCount",
            COUNT(ar.id)::int as "totalCount"
     FROM class_sessions cs
     LEFT JOIN attendance_records ar ON ar.session_id = cs.id
     WHERE cs.class_id = $1 AND cs.ended_at IS NOT NULL
     GROUP BY cs.id
     ORDER BY cs.started_at DESC
     LIMIT $2 OFFSET $3`,
    [classId, limit, offset]
  );
}
