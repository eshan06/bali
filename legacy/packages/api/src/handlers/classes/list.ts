import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries } from '@bali/db';
import { AuthUser } from '../../middleware/auth';
import { json, error } from '../../lib/response';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const archived = event.queryStringParameters?.archived === 'true';
  const classes = await classQueries.findByTeacher(teacher.id, archived);

  return json({ classes });
}
