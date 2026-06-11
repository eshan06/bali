import { query } from '../client';

export async function getByTeacher(teacherId: string) {
  return query(
    `SELECT id, teacher_id as "teacherId", bundle_id as "bundleId",
            app_name as "appName", category, created_at as "createdAt"
     FROM teacher_apps
     WHERE teacher_id = $1
     ORDER BY category, app_name`,
    [teacherId]
  );
}

export async function add(teacherId: string, bundleId: string, appName: string, category?: string) {
  const rows = await query(
    `INSERT INTO teacher_apps (teacher_id, bundle_id, app_name, category)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (teacher_id, bundle_id) DO NOTHING
     RETURNING id, teacher_id as "teacherId", bundle_id as "bundleId",
               app_name as "appName", category, created_at as "createdAt"`,
    [teacherId, bundleId, appName, category || null]
  );
  return rows[0] || null;
}

export async function remove(id: string, teacherId: string) {
  await query(
    `DELETE FROM teacher_apps WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  );
}

export async function seedFromSchoolDefaults(teacherId: string, schoolId: string) {
  // Copy school-wide blocking_apps into teacher's personal catalog (skip duplicates)
  await query(
    `INSERT INTO teacher_apps (teacher_id, bundle_id, app_name, category)
     SELECT $1, ba.bundle_id, ba.app_name, ba.category
     FROM blocking_apps ba
     WHERE ba.school_id = $2
     ON CONFLICT (teacher_id, bundle_id) DO NOTHING`,
    [teacherId, schoolId]
  );
}
