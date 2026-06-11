import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, blockingQueries } from '@bali/db';
import { addBlockingAppSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function listHandler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const apps = await blockingQueries.getAppsBySchool(teacher.schoolId);
  return json({ apps });
}

export async function addHandler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const parsed = parseBody(event, addBlockingAppSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const app = await blockingQueries.addApp(
    teacher.schoolId,
    parsed.data!.bundleId,
    parsed.data!.appName,
    parsed.data!.category,
    parsed.data!.isDefault
  );

  return json(app, 201);
}

export async function removeHandler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  await blockingQueries.removeApp(params.appId);
  return json({ message: 'App removed' });
}
