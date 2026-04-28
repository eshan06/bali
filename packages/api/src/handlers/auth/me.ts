import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, studentQueries } from '@bali/db';
import { SessionUser } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json } from '../../lib/response';

export async function handler(_event: APIGatewayProxyEventV2, user: AuthUser) {
  if (user.role === 'unset') {
    const response: SessionUser = {
      role: 'unset',
      sub: user.sub,
      email: user.email,
      displayName: user.name,
    };
    return json(response);
  }

  if (user.role === 'student') {
    const student = await studentQueries.findByCognitoSub(user.sub);
    const response: SessionUser = {
      role: 'student',
      sub: user.sub,
      email: user.email,
      displayName: student ? `${student.firstName} ${student.lastName}` : user.name,
      student: student || undefined,
    };
    return json(response);
  }

  let teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) {
    const schoolId = process.env.DEFAULT_SCHOOL_ID!;
    teacher = await teacherQueries.create(schoolId, user.sub, user.email, user.name);
  }

  const response: SessionUser = {
    role: 'teacher',
    sub: user.sub,
    email: teacher.email,
    displayName: teacher.displayName,
    teacher,
  };
  return json(response);
}
