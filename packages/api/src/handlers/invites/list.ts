import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries, classInviteQueries } from '@bali/db';
import { TeacherClassInvite } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';

function statusOf(row: { acceptedAt: string | null; revokedAt: string | null }): TeacherClassInvite['status'] {
  if (row.acceptedAt) return 'accepted';
  if (row.revokedAt) return 'revoked';
  return 'pending';
}

export async function handler(
  _event: APIGatewayProxyEventV2,
  user: AuthUser,
  params: Record<string, string>
) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  const rows = await classInviteQueries.listForClass(cls.id);
  const invites: TeacherClassInvite[] = rows.map((r: any) => ({
    id: r.id,
    email: r.email,
    invitedAt: r.createdAt,
    acceptedAt: r.acceptedAt || undefined,
    revokedAt: r.revokedAt || undefined,
    status: statusOf(r),
  }));
  return json({ invites });
}
