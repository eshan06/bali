import { query } from '../client';

export interface ClassInviteRow {
  id: string;
  classId: string;
  email: string;
  invitedBy: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

const SELECT_FIELDS = `
  id, class_id as "classId", email, invited_by as "invitedBy",
  created_at as "createdAt", accepted_at as "acceptedAt",
  revoked_at as "revokedAt"
`;

export async function create(classId: string, email: string, invitedByTeacherId: string): Promise<ClassInviteRow> {
  const rows = await query(
    `INSERT INTO class_invites (class_id, email, invited_by)
     VALUES ($1, LOWER($2), $3)
     RETURNING ${SELECT_FIELDS}`,
    [classId, email, invitedByTeacherId]
  );
  return rows[0];
}

export async function findActiveByClassAndEmail(classId: string, email: string): Promise<ClassInviteRow | null> {
  const rows = await query(
    `SELECT ${SELECT_FIELDS} FROM class_invites
     WHERE class_id = $1 AND LOWER(email) = LOWER($2)
       AND accepted_at IS NULL AND revoked_at IS NULL`,
    [classId, email]
  );
  return rows[0] || null;
}

export async function findById(id: string): Promise<ClassInviteRow | null> {
  const rows = await query(
    `SELECT ${SELECT_FIELDS} FROM class_invites WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/** All invites for a class (pending + accepted + revoked), most recent first. */
export async function listForClass(classId: string) {
  return query(
    `SELECT ${SELECT_FIELDS} FROM class_invites
     WHERE class_id = $1
     ORDER BY created_at DESC`,
    [classId]
  );
}

/** Pending invites for a given email, joined with class/teacher info for the student dashboard. */
export async function listPendingForEmail(email: string) {
  return query(
    `SELECT ci.id as "inviteId",
            c.id as "classId", c.name as "className", c.period,
            t.display_name as "teacherName",
            sch.name as "schoolName",
            ci.created_at as "invitedAt"
     FROM class_invites ci
     JOIN classes c ON c.id = ci.class_id
     JOIN teachers t ON t.id = c.teacher_id
     LEFT JOIN schools sch ON sch.id = c.school_id
     WHERE LOWER(ci.email) = LOWER($1)
       AND ci.accepted_at IS NULL
       AND ci.revoked_at IS NULL
       AND c.is_archived = false
     ORDER BY ci.created_at DESC`,
    [email]
  );
}

export async function markAccepted(id: string) {
  await query(
    `UPDATE class_invites SET accepted_at = NOW() WHERE id = $1`,
    [id]
  );
}

export async function revoke(id: string) {
  await query(
    `UPDATE class_invites SET revoked_at = NOW() WHERE id = $1`,
    [id]
  );
}
