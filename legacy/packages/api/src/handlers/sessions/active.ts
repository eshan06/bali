import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, sessionQueries } from '@bali/db';
import { AuthUser } from '../../middleware/auth';
import { json, error } from '../../lib/response';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const session = await sessionQueries.findActiveByTeacher(teacher.id);
  return json({ session: session || null });
}
