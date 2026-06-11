import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries } from '@bali/db';
import { updateClassSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, updateClassSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  const updated = await classQueries.update(params.classId, parsed.data!);
  return json(updated);
}
