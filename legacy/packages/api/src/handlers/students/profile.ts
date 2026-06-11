import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { teacherQueries, classQueries, studentQueries, attendanceQueries } from '@bali/db';
import { AuthUser } from '../../middleware/auth';
import { json, error, notFound } from '../../lib/response';

export async function handler(event: APIGatewayProxyEventV2, user: AuthUser, params: Record<string, string>) {
  const teacher = await teacherQueries.findByCognitoSub(user.sub);
  if (!teacher) return error('Teacher not found', 404);

  const cls = await classQueries.findById(params.classId);
  if (!cls || cls.teacherId !== teacher.id) return notFound('Class not found');

  const student = await studentQueries.findByIdInClass(params.classId, params.studentId);
  if (!student) return notFound('Student not found in this class');

  const [classes, device, attendanceHistory, attendanceStats, blockingStatus, auditLog] = await Promise.all([
    studentQueries.getClasses(params.studentId),
    studentQueries.getDevice(params.studentId),
    studentQueries.getAttendanceHistory(params.studentId, params.classId),
    studentQueries.getAttendanceStats(params.studentId, params.classId),
    studentQueries.getBlockingStatus(params.studentId),
    attendanceQueries.getAuditLogForStudentInClass(params.studentId, params.classId),
  ]);

  return json({
    student,
    classes,
    device,
    attendanceHistory,
    attendanceStats,
    blockingStatus,
    auditLog,
  });
}
