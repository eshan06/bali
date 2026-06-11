import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { studentQueries, classInviteQueries } from '@bali/db';
import { studentSelfProfileSchema, StudentSelf, StudentClassSummary, PendingInvite } from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';
import { parseBody } from '../../middleware/validate';

function buildResponse(student: any, classes: any[], pendingInvites: any[]): StudentSelf {
  return {
    student,
    classes: classes.map((c): StudentClassSummary => ({
      id: c.id,
      name: c.name,
      period: c.period || undefined,
      teacherName: c.teacherName,
      schoolName: c.schoolName || undefined,
      activeSession: c.activeSession || null,
      attendanceRate: c.attendanceRate ?? 0,
      totalSessions: c.totalSessions ?? 0,
    })),
    pendingInvites: pendingInvites.map((p): PendingInvite => ({
      inviteId: p.inviteId,
      classId: p.classId,
      className: p.className,
      period: p.period || undefined,
      teacherName: p.teacherName,
      schoolName: p.schoolName || undefined,
      invitedAt: p.invitedAt,
    })),
  };
}

export async function getHandler(_event: APIGatewayProxyEventV2, user: AuthUser) {
  if (user.role !== 'student') return error('Student role required', 403);

  const student = await studentQueries.findByCognitoSub(user.sub);
  if (!student) return notFound('Profile not created');

  const [classes, pendingInvites] = await Promise.all([
    studentQueries.getClassSummariesForStudent(student.id),
    classInviteQueries.listPendingForEmail(user.email),
  ]);
  return json(buildResponse(student, classes, pendingInvites));
}

export async function postHandler(event: APIGatewayProxyEventV2, user: AuthUser) {
  if (user.role !== 'student') return error('Student role required', 403);

  const parsed = parseBody(event, studentSelfProfileSchema);
  if (parsed.error) return error(parsed.error);
  const { firstName, lastName, grade } = parsed.data!;

  let student = await studentQueries.findByCognitoSub(user.sub);
  if (student) {
    student = await studentQueries.updateProfile(student.id, {
      firstName,
      lastName,
      grade: grade || undefined,
    });
  } else {
    student = await studentQueries.createForUser(
      user.sub,
      user.email,
      firstName,
      lastName,
      grade || undefined
    );
  }

  const [classes, pendingInvites] = await Promise.all([
    studentQueries.getClassSummariesForStudent(student.id),
    classInviteQueries.listPendingForEmail(user.email),
  ]);
  return json(buildResponse(student, classes, pendingInvites));
}
