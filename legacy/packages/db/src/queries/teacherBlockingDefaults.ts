import { query } from '../client';

export async function get(teacherId: string) {
  const defaults = await query(
    `SELECT id, blocking_mode as "blockingMode", updated_at as "updatedAt"
     FROM teacher_blocking_defaults
     WHERE teacher_id = $1`,
    [teacherId]
  );

  if (defaults.length === 0) {
    return null;
  }

  const config = defaults[0];
  const apps = await query(
    `SELECT ta.id
     FROM teacher_blocking_default_apps tbda
     JOIN teacher_apps ta ON ta.id = tbda.teacher_app_id
     WHERE tbda.default_config_id = $1`,
    [config.id]
  );

  return {
    blockingMode: config.blockingMode,
    appIds: apps.map((a: any) => a.id),
  };
}

export async function save(teacherId: string, blockingMode: string, appIds: string[]) {
  // Upsert default config
  const rows = await query(
    `INSERT INTO teacher_blocking_defaults (teacher_id, blocking_mode, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (teacher_id)
     DO UPDATE SET blocking_mode = $2, updated_at = NOW()
     RETURNING id`,
    [teacherId, blockingMode]
  );

  const configId = rows[0].id;

  // Replace app list
  await query(`DELETE FROM teacher_blocking_default_apps WHERE default_config_id = $1`, [configId]);

  if (appIds.length > 0) {
    const values = appIds.map((_, i) => `($1, $${i + 2})`).join(', ');
    await query(
      `INSERT INTO teacher_blocking_default_apps (default_config_id, teacher_app_id)
       VALUES ${values}
       ON CONFLICT DO NOTHING`,
      [configId, ...appIds]
    );
  }

  return { blockingMode, appIds };
}
