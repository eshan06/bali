import { query } from '../client';

export async function findActiveByTeacher(teacherId: string) {
  const rows = await query(
    `SELECT cs.id, cs.class_id as "classId", cs.teacher_id as "teacherId",
            c.name as "className", cs.started_at as "startedAt",
            cs.blocking_enabled as "blockingEnabled",
            cs.blocking_mode as "blockingMode",
            cs.attendance_threshold_minutes as "attendanceThresholdMinutes",
            cs.blocking_config_snapshot as "blockingConfigSnapshot"
     FROM class_sessions cs
     JOIN classes c ON c.id = cs.class_id
     WHERE cs.teacher_id = $1 AND cs.ended_at IS NULL`,
    [teacherId]
  );
  return rows[0] || null;
}

export async function start(classId: string, teacherId: string, blockingMode = 'block_specific') {
  const rows = await query(
    `INSERT INTO class_sessions (class_id, teacher_id, blocking_mode)
     VALUES ($1, $2, $3)
     RETURNING id, class_id as "classId", teacher_id as "teacherId",
               started_at as "startedAt", blocking_enabled as "blockingEnabled",
               blocking_mode as "blockingMode",
               attendance_threshold_minutes as "attendanceThresholdMinutes",
               blocking_config_snapshot as "blockingConfigSnapshot"`,
    [classId, teacherId, blockingMode]
  );
  return rows[0];
}

export async function setSnapshot(sessionId: string, snapshot: unknown) {
  await query(
    `UPDATE class_sessions SET blocking_config_snapshot = $2 WHERE id = $1`,
    [sessionId, JSON.stringify(snapshot)]
  );
}

export async function end(sessionId: string) {
  const rows = await query(
    `UPDATE class_sessions SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL
     RETURNING id, class_id as "classId", started_at as "startedAt",
               ended_at as "endedAt"`,
    [sessionId]
  );
  return rows[0] || null;
}

export async function findById(id: string) {
  const rows = await query(
    `SELECT cs.id, cs.class_id as "classId", cs.teacher_id as "teacherId",
            c.name as "className", cs.started_at as "startedAt",
            cs.ended_at as "endedAt", cs.blocking_enabled as "blockingEnabled",
            cs.blocking_mode as "blockingMode",
            cs.attendance_threshold_minutes as "attendanceThresholdMinutes",
            cs.blocking_config_snapshot as "blockingConfigSnapshot"
     FROM class_sessions cs
     JOIN classes c ON c.id = cs.class_id
     WHERE cs.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function findByClass(classId: string, limit = 20, offset = 0) {
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

export async function setBlocking(sessionId: string, enabled: boolean, blockingMode?: string) {
  if (blockingMode) {
    await query(
      `UPDATE class_sessions SET blocking_enabled = $2, blocking_mode = $3 WHERE id = $1`,
      [sessionId, enabled, blockingMode]
    );
  } else {
    await query(
      `UPDATE class_sessions SET blocking_enabled = $2 WHERE id = $1`,
      [sessionId, enabled]
    );
  }
}

export async function setBlockingConfig(sessionId: string, blockingMode: string, appIds: string[]) {
  await query(
    `UPDATE class_sessions SET blocking_mode = $2 WHERE id = $1`,
    [sessionId, blockingMode]
  );

  await query(`DELETE FROM session_blocking_apps WHERE session_id = $1`, [sessionId]);

  if (appIds.length > 0) {
    const values = appIds.map((_, i) => `($1, $${i + 2})`).join(', ');
    await query(
      `INSERT INTO session_blocking_apps (session_id, teacher_app_id)
       VALUES ${values}
       ON CONFLICT DO NOTHING`,
      [sessionId, ...appIds]
    );
  }
}

export async function getBlockingConfig(sessionId: string) {
  const rows = await query(
    `SELECT ta.id, ta.bundle_id as "bundleId", ta.app_name as "appName", ta.category
     FROM session_blocking_apps sba
     JOIN teacher_apps ta ON ta.id = sba.teacher_app_id
     WHERE sba.session_id = $1
     ORDER BY ta.category, ta.app_name`,
    [sessionId]
  );
  return rows;
}
