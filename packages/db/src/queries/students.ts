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
            created_at as "createdAt"
     FROM students WHERE id = $1`,
    [id]
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
