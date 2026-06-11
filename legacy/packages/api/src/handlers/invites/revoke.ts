import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries, classInviteQueries } from '@bali/db';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';

export async function handler(
  _event: APIGatewayProxyEventV2,
  user: AuthUser,
  params: Record<string, string>
) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  const invite = await classInviteQueries.findById(params.inviteId);
  if (!invite || invite.classId !== cls.id) return notFound('Invite not found');

  if (invite.acceptedAt) return error('Already accepted, cannot revoke', 409);
  if (invite.revokedAt) return json({ ok: true });

  await classInviteQueries.revoke(invite.id);
  return json({ ok: true });
}
