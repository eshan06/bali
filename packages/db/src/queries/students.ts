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
    `SELECT id, school_id as "schoolId", cognito_sub as "cognitoSub",
            first_name as "firstName", last_name as "lastName",
            email, grade, external_id as "externalId",
            notes, created_at as "createdAt", updated_at as "updatedAt"
     FROM students WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function findByCognitoSub(cognitoSub: string) {
  const rows = await query(
    `SELECT id, school_id as "schoolId", cognito_sub as "cognitoSub",
            first_name as "firstName", last_name as "lastName",
            email, grade, external_id as "externalId",
            notes, created_at as "createdAt", updated_at as "updatedAt"
     FROM students WHERE cognito_sub = $1`,
    [cognitoSub]
  );
  return rows[0] || null;
}

export async function createForUser(
  cognitoSub: string,
  email: string,
  firstName: string,
  lastName: string,
  grade?: string
) {
  const rows = await query(
    `INSERT INTO students (cognito_sub, email, first_name, last_name, grade)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, school_id as "schoolId", cognito_sub as "cognitoSub",
               first_name as "firstName", last_name as "lastName",
               email, grade, external_id as "externalId",
               notes, created_at as "createdAt", updated_at as "updatedAt"`,
    [cognitoSub, email, firstName, lastName, grade || null]
  );
  return rows[0];
}

export async function updateProfile(
  id: string,
  fields: { firstName?: string; lastName?: string; grade?: string }
) {
  const sets: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (fields.firstName !== undefined) { sets.push(`first_name = $${idx++}`); params.push(fields.firstName); }
  if (fields.lastName !== undefined) { sets.push(`last_name = $${idx++}`); params.push(fields.lastName); }
  if (fields.grade !== undefined) { sets.push(`grade = $${idx++}`); params.push(fields.grade || null); }

  if (sets.length === 0) return findById(id);

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const rows = await query(
    `UPDATE students SET ${sets.join(', ')} WHERE id = $${idx}
     RETURNING id, school_id as "schoolId", cognito_sub as "cognitoSub",
               first_name as "firstName", last_name as "lastName",
               email, grade, external_id as "externalId",
               notes, created_at as "createdAt", updated_at as "updatedAt"`,
    params
  );
  return rows[0];
}

/**
 * Sets school_id only if currently null. Used when a student joins their first
 * class — their school comes from that class's teacher.
 */
export async function setSchoolIfNull(id: string, schoolId: string) {
  await query(
    `UPDATE students SET school_id = $2, updated_at = NOW()
     WHERE id = $1 AND school_id IS NULL`,
    [id, schoolId]
  );
}

export async function adoptCognitoSub(id: string, cognitoSub: string) {
  await query(
    `UPDATE students SET cognito_sub = $2, updated_at = NOW() WHERE id = $1`,
    [id, cognitoSub]
  );
}

export async function deleteById(id: string) {
  await query(`DELETE FROM students WHERE id = $1`, [id]);
}

export async function getEnrollment(classId: string, studentId: string) {
  const rows = await query(
    `SELECT class_id as "classId", student_id as "studentId",
            enrolled_at as "enrolledAt"
     FROM class_students WHERE class_id = $1 AND student_id = $2`,
    [classId, studentId]
  );
  return rows[0] || null;
}

/**
 * Per-class summary for the student dashboard:
 * teacher name, current active session (if any), checked-in status, attendance rate.
 */
export async function getClassSummariesForStudent(studentId: string) {
  return query(
    `SELECT c.id, c.name, c.period, c.school_id as "schoolId",
            t.display_name as "teacherName",
            sch.name as "schoolName",
            (
              SELECT json_build_object(
                'id', cs.id,
                'startedAt', cs.started_at,
                'blockingEnabled', cs.blocking_enabled,
                'attendanceStatus', ar.status,
                'checkedIn', ar.check_in_at IS NOT NULL
              )
              FROM class_sessions cs
              LEFT JOIN attendance_records ar
                ON ar.session_id = cs.id AND ar.student_id = $1
              WHERE cs.class_id = c.id AND cs.ended_at IS NULL
              ORDER BY cs.started_at DESC
              LIMIT 1
            ) as "activeSession",
            (
              SELECT COUNT(*)::int FROM (
                SELECT DISTINCT ON ((cs2.started_at AT TIME ZONE 'UTC')::date) ar2.status
                FROM attendance_records ar2
                JOIN class_sessions cs2 ON cs2.id = ar2.session_id
                WHERE ar2.student_id = $1 AND cs2.class_id = c.id
                  AND cs2.ended_at IS NOT NULL
                ORDER BY (cs2.started_at AT TIME ZONE 'UTC')::date DESC, cs2.started_at DESC
              ) d
            ) as "totalSessions",
            (
              SELECT COALESCE(ROUND(
                100.0 * COUNT(CASE WHEN d.status IN ('present', 'late') THEN 1 END)
                / NULLIF(COUNT(*), 0)
              )::int, 0) FROM (
                SELECT DISTINCT ON ((cs3.started_at AT TIME ZONE 'UTC')::date) ar3.status
                FROM attendance_records ar3
                JOIN class_sessions cs3 ON cs3.id = ar3.session_id
                WHERE ar3.student_id = $1 AND cs3.class_id = c.id
                  AND cs3.ended_at IS NOT NULL
                ORDER BY (cs3.started_at AT TIME ZONE 'UTC')::date DESC, cs3.started_at DESC
              ) d
            ) as "attendanceRate"
     FROM class_students enr
     JOIN classes c ON c.id = enr.class_id
     JOIN teachers t ON t.id = c.teacher_id
     LEFT JOIN schools sch ON sch.id = c.school_id
     WHERE enr.student_id = $1 AND c.is_archived = false
     ORDER BY c.name`,
    [studentId]
  );
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

export async function getActiveSessionForClass(studentId: string, classId: string) {
  const rows = await query(
    `SELECT cs.id, cs.started_at as "startedAt",
            cs.blocking_enabled as "blockingEnabled",
            cs.attendance_threshold_minutes as "thresholdMinutes",
            cs.blocking_config_snapshot as "blockingSnapshot",
            ar.status as "attendanceStatus",
            ar.check_in_at as "checkInAt",
            CASE WHEN ar.check_in_at IS NOT NULL THEN true ELSE false END as "checkedIn",
            dbs.is_blocked as "deviceIsBlocked",
            dbs.reported_at as "deviceReportedAt",
            dbs.reported_by as "deviceReportedBy"
     FROM class_sessions cs
     LEFT JOIN attendance_records ar
       ON ar.session_id = cs.id AND ar.student_id = $1
     LEFT JOIN device_blocking_status dbs
       ON dbs.session_id = cs.id AND dbs.student_id = $1
     WHERE cs.class_id = $2 AND cs.ended_at IS NULL
     ORDER BY cs.started_at DESC
     LIMIT 1`,
    [studentId, classId]
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
