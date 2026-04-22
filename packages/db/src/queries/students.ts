import { query } from '../client';

export async function create(schoolId: string, firstName: string, lastName: string, email?: string, externalId?: string) {
  const rows = await query(
    `INSERT INTO students (school_id, first_name, last_name, email, external_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, school_id as "schoolId", first_name as "firstName",
               last_name as "lastName", email, external_id as "externalId",
               created_at as "createdAt"`,
    [schoolId, firstName, lastName, email || null, externalId || null]
  );
  return rows[0];
}

export async function addToClass(classId: string, studentId: string) {
  await query(
    `INSERT INTO class_students (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [classId, studentId]
  );
}

export async function removeFromClass(classId: string, studentId: string) {
  await query(
    `DELETE FROM class_students WHERE class_id = $1 AND student_id = $2`,
    [classId, studentId]
  );
}

export async function findByClass(classId: string) {
  return query(
    `SELECT s.id, s.first_name as "firstName", s.last_name as "lastName",
            s.email, s.external_id as "externalId", cs.enrolled_at as "enrolledAt"
     FROM students s
     JOIN class_students cs ON cs.student_id = s.id
     WHERE cs.class_id = $1
     ORDER BY s.last_name, s.first_name`,
    [classId]
  );
}

export async function findById(id: string) {
  const rows = await query(
    `SELECT id, school_id as "schoolId", first_name as "firstName",
            last_name as "lastName", email, external_id as "externalId",
            notes, created_at as "createdAt"
     FROM students WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function findByIdInClass(classId: string, studentId: string) {
  const rows = await query(
    `SELECT s.id, s.school_id as "schoolId", s.first_name as "firstName",
            s.last_name as "lastName", s.email, s.external_id as "externalId",
            s.notes, s.created_at as "createdAt", s.updated_at as "updatedAt",
            cs.enrolled_at as "enrolledAt"
     FROM students s
     JOIN class_students cs ON cs.student_id = s.id
     WHERE s.id = $1 AND cs.class_id = $2`,
    [studentId, classId]
  );
  return rows[0] || null;
}

export async function getClasses(studentId: string) {
  return query(
    `SELECT c.id, c.name, c.period
     FROM classes c
     JOIN class_students cs ON cs.class_id = c.id
     WHERE cs.student_id = $1
     ORDER BY c.name`,
    [studentId]
  );
}

export async function getAttendanceHistory(studentId: string, classId: string) {
  // Deduplicate by day — only the last session per date counts
  // Joins blocking status to show blocking state per session
  return query(
    `SELECT DISTINCT ON ((cs.started_at AT TIME ZONE 'UTC')::date)
            ar.session_id as "sessionId",
            cs.started_at as "startedAt", cs.ended_at as "endedAt",
            ar.status, ar.check_in_at as "checkInAt",
            CASE WHEN ar.override_by IS NOT NULL THEN true ELSE false END as "isOverride",
            CASE
              WHEN dbs.reported_by = 'student_override' THEN 'student_override'
              WHEN dbs.is_blocked = true THEN 'active'
              WHEN dbs.is_blocked = false THEN 'inactive'
              WHEN cs.blocking_enabled = false THEN 'disabled'
              ELSE 'no_data'
            END as "blockingStatus"
     FROM attendance_records ar
     JOIN class_sessions cs ON cs.id = ar.session_id
     LEFT JOIN device_blocking_status dbs ON dbs.session_id = cs.id AND dbs.student_id = ar.student_id
     WHERE ar.student_id = $1 AND cs.class_id = $2 AND cs.ended_at IS NOT NULL
     ORDER BY (cs.started_at AT TIME ZONE 'UTC')::date DESC, cs.started_at DESC`,
    [studentId, classId]
  );
}

export async function getAttendanceStats(studentId: string, classId: string) {
  // Deduplicate by day — only the last session per date counts toward stats
  const rows = await query(
    `WITH daily AS (
       SELECT DISTINCT ON ((cs.started_at AT TIME ZONE 'UTC')::date)
              ar.status
       FROM attendance_records ar
       JOIN class_sessions cs ON cs.id = ar.session_id
       WHERE ar.student_id = $1 AND cs.class_id = $2 AND cs.ended_at IS NOT NULL
       ORDER BY (cs.started_at AT TIME ZONE 'UTC')::date DESC, cs.started_at DESC
     )
     SELECT
       COUNT(*)::int as "total",
       COUNT(CASE WHEN status = 'present' THEN 1 END)::int as "present",
       COUNT(CASE WHEN status = 'late' THEN 1 END)::int as "late",
       COUNT(CASE WHEN status = 'absent' THEN 1 END)::int as "absent",
       COUNT(CASE WHEN status = 'excused' THEN 1 END)::int as "excused"
     FROM daily`,
    [studentId, classId]
  );
  const r = rows[0] || { total: 0, present: 0, late: 0, absent: 0, excused: 0 };
  return {
    ...r,
    rate: r.total > 0 ? Math.round(((r.present + r.late) / r.total) * 100) : 0,
  };
}

export async function updateNotes(id: string, notes: string) {
  const rows = await query(
    `UPDATE students SET notes = $2, updated_at = NOW() WHERE id = $1
     RETURNING id, notes`,
    [id, notes]
  );
  return rows[0] || null;
}

export async function getBlockingStatus(studentId: string) {
  const rows = await query(
    `SELECT dbs.is_blocked as "isBlocked", dbs.reported_at as "reportedAt",
            dbs.reported_by as "reportedBy"
     FROM device_blocking_status dbs
     JOIN class_sessions cs ON cs.id = dbs.session_id
     WHERE dbs.student_id = $1 AND cs.ended_at IS NULL
     ORDER BY dbs.reported_at DESC
     LIMIT 1`,
    [studentId]
  );
  return rows[0] || null;
}

export async function getDevice(studentId: string) {
  const rows = await query(
    `SELECT id, device_id as "deviceId", friendly_name as "friendlyName"
     FROM devices WHERE student_id = $1 LIMIT 1`,
    [studentId]
  );
  return rows[0] || null;
}

export async function update(id: string, fields: { firstName?: string; lastName?: string; email?: string }) {
  const sets: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (fields.firstName !== undefined) { sets.push(`first_name = $${idx++}`); params.push(fields.firstName); }
  if (fields.lastName !== undefined) { sets.push(`last_name = $${idx++}`); params.push(fields.lastName); }
  if (fields.email !== undefined) { sets.push(`email = $${idx++}`); params.push(fields.email); }

  if (sets.length === 0) return findById(id);

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const rows = await query(
    `UPDATE students SET ${sets.join(', ')} WHERE id = $${idx}
     RETURNING id, first_name as "firstName", last_name as "lastName", email`,
    params
  );
  return rows[0];
}

export async function findBySchoolAndEmail(schoolId: string, email: string) {
  const rows = await query(
    `SELECT id, first_name as "firstName", last_name as "lastName", email
     FROM students WHERE school_id = $1 AND email = $2`,
    [schoolId, email]
  );
  return rows[0] || null;
}
