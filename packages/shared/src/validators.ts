import { z } from 'zod';

export const createClassSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  period: z.string().max(50).optional(),
});

export const updateClassSchema = createClassSchema.partial();

export const addStudentSchema = z.object({
  firstName: z.string().min(1).max(255),
  lastName: z.string().min(1).max(255),
  email: z.string().email().optional().or(z.literal('')),
  externalId: z.string().max(255).optional(),
});

export const csvImportSchema = z.object({
  csv: z.string().min(1),
});

export const startSessionSchema = z.object({
  classId: z.string().uuid(),
});

export const checkInSchema = z.object({
  deviceId: z.string().min(1),
  timestamp: z.string().datetime(),
});

export const attendanceOverrideSchema = z.object({
  status: z.enum(['present', 'late', 'absent', 'excused']),
});

export const registerDeviceSchema = z.object({
  deviceId: z.string().min(1).max(255),
  friendlyName: z.string().max(255).optional(),
});

export const assignDeviceSchema = z.object({
  studentId: z.string().uuid(),
});

export const blockingModeSchema = z.enum(['block_specific', 'block_all_except']);

export const toggleBlockingSchema = z.object({
  enabled: z.boolean(),
  blockingMode: blockingModeSchema.optional(),
  appIds: z.array(z.string().uuid()).optional(),
});

export const addBlockingAppSchema = z.object({
  bundleId: z.string().min(1).max(500),
  appName: z.string().min(1).max(255),
  category: z.string().max(100).optional(),
  isDefault: z.boolean().optional(),
});

export const setSessionBlocklistSchema = z.object({
  appIds: z.array(z.string().uuid()),
});

export const setDeviceBlockingStatusSchema = z.object({
  isBlocked: z.boolean(),
});

export const addTeacherAppSchema = z.object({
  bundleId: z.string().min(1).max(500),
  appName: z.string().min(1).max(255),
  category: z.string().max(100).optional(),
});

export const saveTeacherBlockingDefaultsSchema = z.object({
  blockingMode: blockingModeSchema,
  appIds: z.array(z.string().uuid()),
});

export const setSessionBlockingConfigSchema = z.object({
  blockingMode: blockingModeSchema,
  appIds: z.array(z.string().uuid()),
});

export const blockingPresetSchema = z.enum(['none', 'full_focus', 'no_social_media', 'no_games', 'custom']);

export const setClassBlockingConfigSchema = z.object({
  preset: blockingPresetSchema,
  appIds: z.array(z.string().uuid()).optional(),
});

export const updateStudentNotesSchema = z.object({
  notes: z.string().max(5000),
});

export const studentSelfProfileSchema = z.object({
  firstName: z.string().min(1).max(255),
  lastName: z.string().min(1).max(255),
  grade: z.string().max(50).optional().or(z.literal('')),
});

export type StudentSelfProfileInput = z.infer<typeof studentSelfProfileSchema>;

export const inviteStudentSchema = z.object({
  email: z.string().email().max(255),
});

export type InviteStudentInput = z.infer<typeof inviteStudentSchema>;

export type CreateClassInput = z.infer<typeof createClassSchema>;
export type UpdateClassInput = z.infer<typeof updateClassSchema>;
export type AddStudentInput = z.infer<typeof addStudentSchema>;
export type CsvImportInput = z.infer<typeof csvImportSchema>;
export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
export type AttendanceOverrideInput = z.infer<typeof attendanceOverrideSchema>;
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type AssignDeviceInput = z.infer<typeof assignDeviceSchema>;
export type ToggleBlockingInput = z.infer<typeof toggleBlockingSchema>;
export type AddBlockingAppInput = z.infer<typeof addBlockingAppSchema>;
export type SetSessionBlocklistInput = z.infer<typeof setSessionBlocklistSchema>;
