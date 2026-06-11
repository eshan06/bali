import { z } from 'zod';

/** Wire DTOs shared by apps/api (validation) and apps/web (types). iOS mirrors these
 *  in Swift Codable structs. Dates travel as ISO-8601 strings. */

// ---------- enums ----------
export const chipStateSchema = z.enum([
  'not_joined',
  'focused',
  'pass',
  'emergency_unlocked',
  'revoked',
  'no_device',
  'ended',
]);

export const unlockReasonSchema = z.enum(['family', 'medical', 'safety', 'other', 'skipped']);
export type UnlockReason = z.infer<typeof unlockReasonSchema>;

export const eventTypeSchema = z.enum([
  'session_started',
  'session_extended',
  'session_ended',
  'tapped_in',
  'pass_granted',
  'pass_ended',
  'emergency_unlock',
  'reason_shared',
  'refocused',
  'permission_revoked',
  'permission_restored',
  'member_requested',
  'member_joined',
  'member_approved',
  'member_declined',
  'member_removed',
  'no_device_set',
  'no_device_cleared',
  'tag_created',
  'tag_deactivated',
]);
export type EventType = z.infer<typeof eventTypeSchema>;

// ---------- auth ----------
export const bootstrapBodySchema = z.object({
  role: z.enum(['teacher', 'student']),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
});

// ---------- teacher: classes / policies / tags ----------
export const createClassBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  daysLabel: z.string().trim().max(40).default('Mon–Fri'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/), // "10:00"
  endTime: z.string().regex(/^\d{2}:\d{2}$/), // "10:45" — the bell
  policyId: z.string().uuid().optional(),
  requireApproval: z.boolean().default(false),
});

export const updateClassBodySchema = createClassBodySchema.partial().extend({
  archived: z.boolean().optional(),
});

export const createPolicyBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  messagesAllowed: z.boolean().default(true),
  allowedAppLabels: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});
export const updatePolicyBodySchema = createPolicyBodySchema.partial();

export const createTagBodySchema = z.object({
  label: z.string().trim().min(1).max(80),
  /** Provided when the iPhone already wrote a code onto the physical tag. */
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{10}$/)
    .optional(),
});
export const updateTagBodySchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
});

// ---------- sessions ----------
export const startSessionBodySchema = z.object({
  /** ISO datetime. UI prefills the class bell. */
  endsAt: z.string().datetime({ offset: true }),
  policyId: z.string().uuid().optional(),
});

export const extendSessionBodySchema = z.object({
  minutes: z.number().int().min(1).max(120),
});

export const grantPassBodySchema = z.object({
  studentId: z.string().uuid(),
  minutes: z.number().int().min(1).max(60),
  reason: z.string().trim().max(120).optional(),
});

export const noDeviceBodySchema = z.object({ on: z.boolean() });

// ---------- student ----------
export const joinBodySchema = z.object({
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{8}$/)),
});

export const resolveTagBodySchema = z.object({
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{10}$/)),
});

export const tapInBodySchema = z.object({
  clientEventId: z.string().uuid(),
  /** Device-clock tap time for offline-verified taps. */
  tappedAt: z.string().datetime({ offset: true }).optional(),
});

export const heartbeatBodySchema = z.object({
  permissionOk: z.boolean(),
  shieldsApplied: z.boolean(),
});

export const unlockBodySchema = z.object({
  clientEventId: z.string().uuid(),
  at: z.string().datetime({ offset: true }).optional(),
});

export const unlockReasonBodySchema = z.object({ reason: unlockReasonSchema });

// ---------- settings ----------
export const updateSettingsBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  schoolName: z.string().trim().min(1).max(120).optional(),
  notifyEmergency: z.boolean().optional(),
  notifyRevoked: z.boolean().optional(),
  notifyWeekly: z.boolean().optional(),
});

// ---------- response shapes (types only; server constructs, clients consume) ----------

export interface ParticipantDTO {
  participationId: string | null;
  studentId: string;
  firstName: string;
  lastName: string;
  /** "Jordan P." — precomputed so every surface renders names identically. */
  shortName: string;
  state: z.infer<typeof chipStateSchema>;
  passRemainingSeconds: number | null;
  passEndsAt: string | null;
  staleSeconds: number | null;
  isStale: boolean;
  tappedInAt: string | null;
  /** Pending unlock (reason not yet shared), for toast subtitles. */
  pendingUnlockId: string | null;
}

export interface SessionDTO {
  id: string;
  classId: string;
  className: string;
  policyName: string;
  allowedAppLabels: string[];
  messagesAllowed: boolean;
  startedAt: string;
  endsAt: string;
  endedAt: string | null;
}

export interface SessionDetailDTO {
  session: SessionDTO;
  participants: ParticipantDTO[];
  /** Per-state counts for the summary strip, server-computed. */
  counts: Record<z.infer<typeof chipStateSchema>, number>;
}

export interface EventDTO {
  id: string;
  type: EventType;
  at: string;
  classId: string | null;
  sessionId: string | null;
  studentName: string | null;
  className: string | null;
  /** Human line + optional subline, server-rendered so all timelines match. */
  title: string;
  subtitle: string | null;
}

export type SSEMessage =
  | { kind: 'snapshot'; detail: SessionDetailDTO }
  | { kind: 'participant'; participant: ParticipantDTO; counts: SessionDetailDTO['counts'] }
  | { kind: 'session'; session: SessionDTO }
  | { kind: 'event'; event: EventDTO }
  | { kind: 'ping'; at: string };
