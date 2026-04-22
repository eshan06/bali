export interface School {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Teacher {
  id: string;
  schoolId: string;
  cognitoSub: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export type BlockingPreset = 'none' | 'full_focus' | 'no_social_media' | 'no_games' | 'custom';

export interface Class {
  id: string;
  schoolId: string;
  teacherId: string;
  name: string;
  description?: string;
  period?: string;
  isArchived: boolean;
  blockingPreset: BlockingPreset;
  createdAt: string;
  updatedAt: string;
  studentCount?: number;
}

export interface ClassBlockingConfig {
  preset: BlockingPreset;
  customApps: TeacherApp[];
}

export interface Student {
  id: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  email?: string;
  externalId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentProfile {
  student: Student & { enrolledAt: string };
  classes: Array<{ id: string; name: string; period?: string }>;
  device: {
    id: string;
    deviceId: string;
    friendlyName?: string;
  } | null;
  attendanceHistory: Array<{
    sessionId: string;
    startedAt: string;
    endedAt?: string;
    status: string;
    checkInAt?: string;
    isOverride: boolean;
    blockingStatus: 'active' | 'inactive' | 'student_override' | 'disabled' | 'no_data';
  }>;
  attendanceStats: {
    total: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
    rate: number;
  };
  blockingStatus: {
    isBlocked: boolean;
    reportedAt: string;
    reportedBy: string;
  } | null;
  auditLog: Array<{
    sessionId: string;
    oldStatus: string;
    newStatus: string;
    changedAt: string;
    changedByName?: string;
  }>;
}

export interface ClassStudent {
  classId: string;
  studentId: string;
  enrolledAt: string;
}

export interface Device {
  id: string;
  schoolId: string;
  deviceId: string;
  friendlyName?: string;
  studentId?: string;
  studentName?: string;
  registeredAt: string;
  updatedAt: string;
}

export type BlockingMode = 'block_specific' | 'block_all_except';

export interface ClassSession {
  id: string;
  classId: string;
  teacherId: string;
  className?: string;
  startedAt: string;
  endedAt?: string;
  blockingEnabled: boolean;
  blockingMode: BlockingMode;
  attendanceThresholdMinutes: number;
  createdAt: string;
}

export interface TeacherApp {
  id: string;
  teacherId: string;
  bundleId: string;
  appName: string;
  category?: string;
  createdAt: string;
}

export interface TeacherBlockingDefaults {
  blockingMode: BlockingMode;
  appIds: string[];
}

export interface SessionBlockingConfig {
  blockingMode: BlockingMode;
  apps: TeacherApp[];
}

export interface CheckIn {
  id: string;
  sessionId: string;
  deviceId: string;
  studentId?: string;
  tapTimestamp: string;
  receivedAt: string;
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  firstName?: string;
  lastName?: string;
  status: 'present' | 'late' | 'absent' | 'excused';
  checkInAt?: string;
  markedAt: string;
  overrideBy?: string;
  isOverride: boolean;
}

export interface BlockingApp {
  id: string;
  schoolId: string;
  bundleId: string;
  appName: string;
  category?: string;
  isDefault: boolean;
  createdAt: string;
}

export interface DeviceBlockingStatus {
  studentId: string;
  isBlocked: boolean;
  reportedAt: string;
  reportedBy: 'manual' | 'device' | 'student_override';
}

export interface BlockingPolicy {
  blocking: boolean;
  blockingMode: BlockingMode;
  blockedApps: string[];
  allowedApps: string[];
  sessionId?: string;
  updatedAt?: string;
}

export interface SessionAttendanceSummary {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  totalCount: number;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface CsvImportResult {
  imported: number;
  errors: Array<{ row: number; message: string }>;
}
