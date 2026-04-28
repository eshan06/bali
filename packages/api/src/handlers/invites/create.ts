import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries, studentQueries, classInviteQueries } from '@bali/db';
import { inviteStudentSchema, TeacherClassInvite } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound, conflict } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

export async function handler(
  event: APIGatewayProxyEventV2,
  user: AuthUser,
  params: Record<string, string>
) {
  const parsed = parseBody(event, inviteStudentSchema);
  if (parsed.error) return error(parsed.error);
  const email = parsed.data!.email.trim().toLowerCase();

  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  // If a student with this email is already enrolled in this class, no point inviting.
  const existingStudent = await studentQueries.findBySchoolAndEmail(teacher.schoolId, email);
  if (existingStudent) {
    const enrollment = await studentQueries.getEnrollment(cls.id, existingStudent.id);
    if (enrollment) return conflict('That student is already in this class');
  }

  const existingInvite = await classInviteQueries.findActiveByClassAndEmail(cls.id, email);
  if (existingInvite) return conflict('That email already has a pending invite');

  const invite = await classInviteQueries.create(cls.id, email, teacher.id);

  const response: TeacherClassInvite = {
    id: invite.id,
    email: invite.email,
    invitedAt: invite.createdAt,
    status: 'pending',
  };
  return json(response, 201);
}
