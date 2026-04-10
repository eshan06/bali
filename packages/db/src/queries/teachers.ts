import { query } from '../client';

export async function findByCognitoSub(cognitoSub: string) {
  const rows = await query(
    `SELECT id, school_id as "schoolId", cognito_sub as "cognitoSub", email,
            display_name as "displayName", role, created_at as "createdAt"
     FROM teachers WHERE cognito_sub = $1`,
    [cognitoSub]
  );
  return rows[0] || null;
}

export async function create(schoolId: string, cognitoSub: string, email: string, displayName: string) {
  const rows = await query(
    `INSERT INTO teachers (school_id, cognito_sub, email, display_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, school_id as "schoolId", cognito_sub as "cognitoSub", email,
               display_name as "displayName", role, created_at as "createdAt"`,
    [schoolId, cognitoSub, email, displayName]
  );
  return rows[0];
}

export async function findById(id: string) {
  const rows = await query(
    `SELECT id, school_id as "schoolId", cognito_sub as "cognitoSub", email,
            display_name as "displayName", role, created_at as "createdAt"
     FROM teachers WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}
