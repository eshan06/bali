import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries } from '@bali/db';
import { AuthUser } from '../../middleware/auth';
import { json } from '../../lib/response';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser) {
  let teacher = await teacherQueries.findByCognitoSub(user.sub);

  if (!teacher) {
    const schoolId = process.env.DEFAULT_SCHOOL_ID!;
    teacher = await teacherQueries.create(schoolId, user.sub, user.email, user.name);
  }

  return json(teacher);
}
