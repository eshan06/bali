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
  /** null detaches the policy (W6's "detach from N classes first" path). */
  policyId: z.string().uuid().nullable().optional(),
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

// ---------- membership (T7 default no-device) ----------
export const updateMembershipBodySchema = z.object({
  /** Standing "no device" mark — carried into every session as `no_device`. */
  defaultNoDevice: z.boolean().optional(),
});

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
  notifyPassEndings: z.boolean().optional(),
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

// ---------- teacher iOS addendum (T6 overview, T10 recap, T3 recent) ----------

/** T6 · Overview quick stats + last-session recap pointer. */
export interface ClassOverviewDTO {
  classId: string;
  memberCount: number;
  sessionsThisWeek: number;
  medianFocusMinutes: number | null;
  lastSession: {
    sessionId: string;
    dayLabel: string;
    durationMinutes: number;
    durationLabel: string;
    focusedCount: number;
    totalMembers: number;
  } | null;
}

/** One emergency on the T10 recap — listed plainly, with a check-in nudge (never a hook). */
export interface RecapEmergencyDTO {
  studentId: string;
  studentName: string;
  shortName: string;
  atLabel: string;
  /** "Reason shared: family" | "Reason pending" | "Reason: skipped" */
  reasonLabel: string;
  /** "re-focused 10:35" | null */
  refocusedLabel: string | null;
  /** "A quiet check-in with Sam later might be welcome." */
  nudge: string;
}

/** T10 · Session Recap — neutral history. No ranking, no scoreboard, zero red. */
export interface SessionRecapDTO {
  sessionId: string;
  classId: string;
  className: string;
  /** "today 9:50–10:45" — day word + scheduled clock range. */
  scheduleLabel: string;
  durationMinutes: number;
  durationLabel: string;
  endReason: 'bell' | 'teacher' | null;
  endedEarly: boolean;
  isLive: boolean;
  focusedCount: number;
  emergencyCount: number;
  passCount: number;
  permissionOffCount: number;
  neverJoinedCount: number;
  studentsTappedIn: number;
  totalMembers: number;
  medianFocusMinutes: number | null;
  /** Short names of students the teacher marked no-device — plain, never flagged. */
  noDeviceNames: string[];
  /** All focused, no emergencies, no permission-off → the "Smooth period." celebration. */
  clean: boolean;
  emergencies: RecapEmergencyDTO[];
  framing: string;
}

/** One row on T3 · Recent — a past session's outcome, status only. */
export interface StudentHistoryRowDTO {
  sessionId: string;
  /** "Tue" — weekday abbreviation. */
  dayLabel: string;
  /** Display state for the grayscale-safe dot (per §2). */
  state: z.infer<typeof chipStateSchema>;
  /** "Focused 41 min · 1 unlock, re-focused" — factual, never a verdict. */
  label: string;
}

export interface StudentHistoryDTO {
  studentId: string;
  studentName: string;
  shortName: string;
  rows: StudentHistoryRowDTO[];
  framing: string;
  /** "Session status only — Bali never sees Sam's screen, apps, messages, or location." */
  boundary: string;
}

/** Returned once when a teacher mints a parent link — `token` is the URL secret, shown
 *  only at creation (the server stores only its hash). */
export interface ParentLinkDTO {
  token: string;
  createdAt: string;
  revoked: boolean;
}

/** The unauthenticated read-only parent surface for one (student × class). Composed
 *  entirely from the existing event-stream reports — status only, never screen content. */
export interface ParentViewDTO {
  studentShortName: string;
  className: string;
  /** The teacher's "shown to students as" display name. */
  teacherName: string;
  schoolName: string;
  /** "as of Jun 15, 9:41 AM" — when this view was rendered. */
  generatedAtLabel: string;
  /** Present only while a session is live right now; status-only chip. */
  live: { state: z.infer<typeof chipStateSchema>; label: string } | null;
  /** Honest at-a-glance counts over the shown history window. `focusedSessions` counts
   *  sessions the student ended in the `focused` state; `totalUnlocks` is the true count. */
  summary: { sessionsShown: number; focusedSessions: number; totalUnlocks: number };
  /** Reuses the T3 Recent payload verbatim (rows + framing + privacy boundary copy). */
  history: StudentHistoryDTO;
}

export type SSEMessage =
  | { kind: 'snapshot'; detail: SessionDetailDTO }
  | { kind: 'participant'; participant: ParticipantDTO; counts: SessionDetailDTO['counts'] }
  | { kind: 'session'; session: SessionDTO }
  | { kind: 'event'; event: EventDTO }
  | { kind: 'ping'; at: string };
