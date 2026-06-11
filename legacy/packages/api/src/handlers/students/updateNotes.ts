import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries, studentQueries } from '@bali/db';
import { updateStudentNotesSchema } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { parseBody } from '../../middleware/validate';
import { json, error, notFound } from '../../lib/response';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const parsed = parseBody(event, updateStudentNotesSchema);
  if (parsed.error) return error(parsed.error);

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  const student = await studentQueries.findByIdInClass(params.classId, params.studentId);
  if (!student) return notFound('Student not found in this class');

  const result = await studentQueries.updateNotes(params.studentId, parsed.data!.notes);
  return json(result);
}
