import { query } from '../client';

export async function create(schoolId: string, teacherId: string, name: string, description?: string, period?: string) {
  const rows = await query(
    `INSERT INTO classes (school_id, teacher_id, name, description, period)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, school_id as "schoolId", teacher_id as "teacherId", name,
               description, period, is_archived as "isArchived",
               created_at as "createdAt", updated_at as "updatedAt"`,
    [schoolId, teacherId, name, description || null, period || null]
  );
  return rows[0];
}

export async function findByTeacher(teacherId: string, includeArchived = false) {
  const rows = await query(
    `SELECT c.id, c.name, c.period, c.is_archived as "isArchived",
            c.blocking_preset as "blockingPreset",
            c.created_at as "createdAt",
            COUNT(cs.id)::int as "studentCount"
     FROM classes c
     LEFT JOIN class_students cs ON cs.class_id = c.id
     WHERE c.teacher_id = $1 ${includeArchived ? '' : 'AND c.is_archived = false'}
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [teacherId]
  );
  return rows;
}

export async function findById(id: string) {
  const rows = await query(
    `SELECT id, school_id as "schoolId", teacher_id as "teacherId", name,
            description, period, is_archived as "isArchived",
            blocking_preset as "blockingPreset",
            created_at as "createdAt", updated_at as "updatedAt"
     FROM classes WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function update(id: string, fields: { name?: string; description?: string; period?: string }) {
  const sets: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (fields.name !== undefined) { sets.push(`name = $${idx++}`); params.push(fields.name); }
  if (fields.description !== undefined) { sets.push(`description = $${idx++}`); params.push(fields.description); }
  if (fields.period !== undefined) { sets.push(`period = $${idx++}`); params.push(fields.period); }

  if (sets.length === 0) return findById(id);

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const rows = await query(
    `UPDATE classes SET ${sets.join(', ')} WHERE id = $${idx}
     RETURNING id, school_id as "schoolId", teacher_id as "teacherId", name,
               description, period, is_archived as "isArchived",
               created_at as "createdAt", updated_at as "updatedAt"`,
    params
  );
  return rows[0];
}

export async function archive(id: string) {
  await query(`UPDATE classes SET is_archived = true, updated_at = NOW() WHERE id = $1`, [id]);
}

/**
 * Public-ish join preview: class name + teacher + school for the invite landing page.
 */
export async function findPreviewById(id: string) {
  const rows = await query(
    `SELECT c.id, c.name, c.period, c.is_archived as "isArchived",
            c.school_id as "schoolId",
            t.display_name as "teacherName",
            sch.name as "schoolName"
     FROM classes c
     JOIN teachers t ON t.id = c.teacher_id
     LEFT JOIN schools sch ON sch.id = c.school_id
     WHERE c.id = $1`,
    [id]
  );
  return rows[0] || null;
}
