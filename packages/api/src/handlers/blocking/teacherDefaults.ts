import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, teacherBlockingDefaultQueries } from '@bali/db';
import { saveTeacherBlockingDefaultsSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function getHandler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const defaults = await teacherBlockingDefaultQueries.get(teacher.id);
  return json({ defaults: defaults || { blockingMode: 'block_specific', appIds: [] } });
}

export async function saveHandler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const parsed = parseBody(event, saveTeacherBlockingDefaultsSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const result = await teacherBlockingDefaultQueries.save(
    teacher.id,
    parsed.data!.blockingMode,
    parsed.data!.appIds
  );
  return json({ defaults: result });
}
