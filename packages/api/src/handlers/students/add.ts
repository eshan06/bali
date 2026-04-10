import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries, studentQueries } from '@bali/db';
import { addStudentSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, addStudentSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  const { firstName, lastName, email, externalId } = parsed.data!;

  // Check if student already exists in school by email
  let student = email ? await studentQueries.findBySchoolAndEmail(teacher.schoolId, email) : null;

  if (!student) {
    student = await studentQueries.create(teacher.schoolId, firstName, lastName, email || undefined, externalId);
  }

  await studentQueries.addToClass(cls.id, student.id);

  return json(student, 201);
}
