import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { classQueries, studentQueries, classInviteQueries } from '@bali/db';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';

export async function handler(
  _event: APIGatewayProxyEventV2,
  user: AuthUser,
  params: Record<string, string>
) {
  if (user.role !== 'student') return error('Student role required', 403);

  const invite = await classInviteQueries.findById(params.inviteId);
  if (!invite || invite.revokedAt) return notFound('Invite not found');
  if (invite.acceptedAt) return error('Invite already accepted', 409);

  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return error('This invite is for a different email address', 403);
  }

  const cls = await classQueries.findById(invite.classId);
  if (!cls || cls.isArchived) return notFound('Class not found');

  let student = await studentQueries.findByCognitoSub(user.sub);
  if (!student) return error('Complete your profile before accepting invites', 409);

  // Same adoption logic as direct join: prefer the teacher-pre-created row
  // (so any prior enrollments / attendance history attach to this student).
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
  await classInviteQueries.markAccepted(invite.id);

  return json({ studentId: student.id, classId: cls.id });
}
