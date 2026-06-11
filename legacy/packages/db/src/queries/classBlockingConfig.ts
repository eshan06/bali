import { query } from '../client';

export async function getConfig(classId: string) {
  const cls = await query(
    `SELECT blocking_preset as "preset" FROM classes WHERE id = $1`,
    [classId]
  );
  if (cls.length === 0) return null;

  const apps = await query(
    `SELECT ta.id, ta.teacher_id as "teacherId", ta.bundle_id as "bundleId",
            ta.app_name as "appName", ta.category, ta.created_at as "createdAt"
     FROM class_blocked_apps cba
     JOIN teacher_apps ta ON ta.id = cba.teacher_app_id
     WHERE cba.class_id = $1
     ORDER BY ta.app_name`,
    [classId]
  );

  return {
    preset: cls[0].preset,
    customApps: apps,
  };
}

export async function setConfig(classId: string, preset: string, appIds: string[] = []) {
  await query(
    `UPDATE classes SET blocking_preset = $2, updated_at = NOW() WHERE id = $1`,
    [classId, preset]
  );

  // Replace custom app list
  await query(`DELETE FROM class_blocked_apps WHERE class_id = $1`, [classId]);

  if (preset === 'custom' && appIds.length > 0) {
    const values = appIds.map((_, i) => `($1, $${i + 2})`).join(', ');
    await query(
      `INSERT INTO class_blocked_apps (class_id, teacher_app_id)
       VALUES ${values}
       ON CONFLICT DO NOTHING`,
      [classId, ...appIds]
    );
  }
}
