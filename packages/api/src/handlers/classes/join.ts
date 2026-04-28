import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { classQueries, studentQueries } from '@bali/db';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';

export async function handler(
  _event: APIGatewayProxyEventV2,
  user: AuthUser,
  params: Record<string, string>
) {
  if (user.role !== 'student') return error('Student role required', 403);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.isArchived) return notFound('Class not found');

  let student = await studentQueries.findByCognitoSub(user.sub);
  if (!student) return error('Complete your profile before joining a class', 409);

  // If a teacher pre-created a student row in this school with the same email,
  // adopt that row so any prior enrollments / attendance history attach to the
  // signed-in student. Then drop the now-empty self-created row.
  if (student.email && cls.schoolId) {
    const existing = await studentQueries.findBySchoolAndEmail(cls.schoolId, student.email);
    if (existing && existing.id !== student.id && !existing.cognitoSub) {
      await studentQueries.adoptCognitoSub(existing.id, user.sub);
      await studentQueries.deleteById(student.id);
      student = await studentQueries.findById(existing.id);
    }
  }

  await studentQueries.setSchoolIfNull(student.id, cls.schoolId);
  await studentQueries.addToClass(cls.id, student.id);

  return json({ studentId: student.id, classId: cls.id }, 201);
}
