import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries } from '@bali/db';
import { createClassSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const parsed = parseBody(event, createClassSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.create(
    teacher.schoolId, teacher.id, parsed.data!.name, parsed.data!.description, parsed.data!.period
  );

  return json(cls, 201);
}
