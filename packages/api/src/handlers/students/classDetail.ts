import { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  studentQueries,
  classQueries,
} from '@bali/db';
import {
  INACTIVE_BLOCKING_SNAPSHOT,
  StudentClassDetail,
  StudentActiveSessionInfo,
  type BlockingSnapshot,
} from '@bali/shared';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';

export async function handler(
  _event: APIGatewayProxyEventV2,
  user: AuthUser,
  params: Record<string, string>
) {
  if (user.role !== 'student') return error('Student role required', 403);

  const student = await studentQueries.findByCognitoSub(user.sub);
  if (!student) return notFound('Profile not created');

  const enrollment = await studentQueries.getEnrollment(
    params.classId,
    student.id
  );
  if (!enrollment) return notFound('Class not found');

  const [cls, attendance, recent, device, activeRow] = await Promise.all([
    classQueries.findPreviewById(params.classId),
    studentQueries.getAttendanceStats(student.id, params.classId),
    studentQueries.getAttendanceHistory(student.id, params.classId),
    studentQueries.getDevice(student.id),
    studentQueries.getActiveSessionForClass(student.id, params.classId),
  ]);

  if (!cls) return notFound('Class not found');

  let activeSession: StudentActiveSessionInfo | null = null;
  if (activeRow) {
    const snapshot: BlockingSnapshot =
      (activeRow.blockingSnapshot as BlockingSnapshot | null) ??
      INACTIVE_BLOCKING_SNAPSHOT;
    const status =
      activeRow.attendanceStatus === 'present' ||
      activeRow.attendanceStatus === 'late'
        ? activeRow.attendanceStatus
        : null;
    activeSession = {
      id: activeRow.id,
      startedAt: activeRow.startedAt,
      blockingEnabled: !!activeRow.blockingEnabled,
      checkedIn: !!activeRow.checkedIn,
      attendanceStatus: status,
      checkInAt: activeRow.checkInAt ?? null,
      blockingSnapshot: snapshot,
      deviceBlockingStatus:
        activeRow.deviceReportedAt !== null &&
        activeRow.deviceReportedAt !== undefined
          ? {
              isBlocked: !!activeRow.deviceIsBlocked,
              reportedAt: activeRow.deviceReportedAt,
              reportedBy: activeRow.deviceReportedBy ?? 'device',
            }
          : null,
    };
  }

  const response: StudentClassDetail = {
    class: {
      id: cls.id,
      name: cls.name,
      period: cls.period || undefined,
      teacherName: cls.teacherName,
      schoolName: cls.schoolName || undefined,
    },
    attendance,
    activeSession,
    recentSessions: recent.map((r: any) => ({
      sessionId: r.sessionId,
      startedAt: r.startedAt,
      endedAt: r.endedAt ?? null,
      status: r.status,
      checkInAt: r.checkInAt ?? null,
      isOverride: !!r.isOverride,
      blockingStatus: r.blockingStatus,
    })),
    device: device
      ? {
          deviceId: device.deviceId,
          friendlyName: device.friendlyName || undefined,
        }
      : null,
  };

  return json(response);
}
