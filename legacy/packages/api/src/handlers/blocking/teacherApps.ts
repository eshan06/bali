import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, teacherAppQueries } from '@bali/db';
import { addTeacherAppSchema, SYSTEM_PROTECTED_BUNDLE_IDS } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function listHandler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  // Seed from school defaults on first access if teacher has no apps yet
  const apps = await teacherAppQueries.getByTeacher(teacher.id);
  if (apps.length === 0) {
    await teacherAppQueries.seedFromSchoolDefaults(teacher.id, teacher.schoolId);
    const seeded = await teacherAppQueries.getByTeacher(teacher.id);
    return json({ apps: seeded });
  }

  return json({ apps });
}

export async function addHandler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const parsed = parseBody(event, addTeacherAppSchema);
  if (parsed.error) return error(parsed.error);

  const { bundleId, appName, category } = parsed.data!;

  // Reject system-protected apps
  if ((SYSTEM_PROTECTED_BUNDLE_IDS as readonly string[]).includes(bundleId)) {
    return error('Cannot add system-protected apps (Phone, iMessage)');
  }

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const app = await teacherAppQueries.add(teacher.id, bundleId, appName, category);
  if (!app) return error('App with this bundle ID already exists in your list');

  return json(app, 201);
}

export async function removeHandler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  await teacherAppQueries.remove(params.appId, teacher.id);
  return json({ ok: true });
}
