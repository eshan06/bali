import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries, classBlockingConfigQueries } from '@bali/db';
import { setClassBlockingConfigSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function getHandler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  const config = await classBlockingConfigQueries.getConfig(params.classId);
  return json({ config: config || { preset: 'none', customApps: [] } });
}

export async function setHandler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, setClassBlockingConfigSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  await classBlockingConfigQueries.setConfig(
    params.classId,
    parsed.data!.preset,
    parsed.data!.appIds || []
  );

  const config = await classBlockingConfigQueries.getConfig(params.classId);
  return json({ config });
}
