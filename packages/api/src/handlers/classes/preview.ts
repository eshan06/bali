import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { classQueries, studentQueries } from '@bali/db';
import { ClassJoinPreview } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, notFound, error } from '../../lib/response';

export async function handler(
  _event: APIGatewayProxyEventV2,
  user: AuthUser,
  params: Record<string, string>
) {
  const cls = await classQueries.findPreviewById(params.classId);
  if (!cls || cls.isArchived) return notFound('Class not found');

  let alreadyEnrolled = false;
  if (user.role === 'student') {
    const student = await studentQueries.findByCognitoSub(user.sub);
    if (student) {
      const enrollment = await studentQueries.getEnrollment(cls.id, student.id);
      alreadyEnrolled = !!enrollment;
    }
  } else if (user.role === 'teacher') {
    return error('Teachers cannot join classes as students', 403);
  }

  const response: ClassJoinPreview = {
    classId: cls.id,
    className: cls.name,
    period: cls.period || undefined,
    teacherName: cls.teacherName,
    schoolName: cls.schoolName || undefined,
    alreadyEnrolled,
  };
  return json(response);
}
