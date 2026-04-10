import { query } from '../client';

export async function register(schoolId: string, deviceId: string, friendlyName?: string) {
  const rows = await query(
    `INSERT INTO devices (school_id, device_id, friendly_name)
     VALUES ($1, $2, $3)
     RETURNING id, device_id as "deviceId", friendly_name as "friendlyName",
               student_id as "studentId", registered_at as "registeredAt"`,
    [schoolId, deviceId, friendlyName || null]
  );
  return rows[0];
}

export async function findByDeviceId(deviceId: string) {
  const rows = await query(
    `SELECT d.id, d.school_id as "schoolId", d.device_id as "deviceId",
            d.friendly_name as "friendlyName", d.student_id as "studentId",
            s.first_name || ' ' || s.last_name as "studentName"
     FROM devices d
     LEFT JOIN students s ON s.id = d.student_id
     WHERE d.device_id = $1`,
    [deviceId]
  );
  return rows[0] || null;
}

export async function findBySchool(schoolId: string) {
  return query(
    `SELECT d.id, d.device_id as "deviceId", d.friendly_name as "friendlyName",
            d.student_id as "studentId",
            s.first_name || ' ' || s.last_name as "studentName",
            d.registered_at as "registeredAt"
     FROM devices d
     LEFT JOIN students s ON s.id = d.student_id
     WHERE d.school_id = $1
     ORDER BY d.registered_at DESC`,
    [schoolId]
  );
}

export async function assign(deviceId: string, studentId: string) {
  const rows = await query(
    `UPDATE devices SET student_id = $2, updated_at = NOW() WHERE device_id = $1
     RETURNING id, device_id as "deviceId", student_id as "studentId"`,
    [deviceId, studentId]
  );
  return rows[0] || null;
}

export async function unassign(deviceId: string) {
  const rows = await query(
    `UPDATE devices SET student_id = NULL, updated_at = NOW() WHERE device_id = $1
     RETURNING id, device_id as "deviceId"`,
    [deviceId]
  );
  return rows[0] || null;
}
