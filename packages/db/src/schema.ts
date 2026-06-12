import {
  bigserial,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Timestamps are timestamptz everywhere; the API speaks ISO-8601. */
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------- enums ----------
export const membershipStatusEnum = pgEnum('membership_status', ['pending', 'active']);
export const participantStateEnum = pgEnum('participant_state', [
  'not_joined',
  'focused',
  'pass',
  'emergency_unlocked',
  'revoked',
  'ended',
]);
export const sessionEndReasonEnum = pgEnum('session_end_reason', ['bell', 'teacher']);
export const unlockReasonEnum = pgEnum('unlock_reason', [
  'family',
  'medical',
  'safety',
  'other',
  'skipped',
]);
export const eventTypeEnum = pgEnum('event_type', [
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

// ---------- identity ----------
export const schools = pgTable('schools', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const teachers = pgTable(
  'teachers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id),
    cognitoSub: text('cognito_sub').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** "Shown to students as" — the one opinionated settings field (W10). */
    displayName: text('display_name').notNull(),
    notifyEmergency: boolean('notify_emergency').notNull().default(true),
    notifyRevoked: boolean('notify_revoked').notNull().default(true),
    notifyWeekly: boolean('notify_weekly').notNull().default(false),
    /** T5's third toggle — stored intent like the others (delivery is stubbed). */
    notifyPassEndings: boolean('notify_pass_endings').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('teachers_cognito_sub_uq').on(t.cognitoSub)],
);

export const students = pgTable(
  'students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schoolId: uuid('school_id').references(() => schools.id),
    cognitoSub: text('cognito_sub'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('students_cognito_sub_uq').on(t.cognitoSub)],
);

// ---------- classroom ----------
export const policies = pgTable('policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  teacherId: uuid('teacher_id')
    .notNull()
    .references(() => teachers.id),
  name: text('name').notNull(),
  messagesAllowed: boolean('messages_allowed').notNull().default(true),
  /** Semantic labels only ("Notes", "Camera", …) — Bali never sees real app lists. */
  allowedAppLabels: text('allowed_app_labels').array().notNull().default([]),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const classes = pgTable(
  'classes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id),
    name: text('name').notNull(),
    daysLabel: text('days_label').notNull().default('Mon–Fri'),
    startTime: time('start_time').notNull(),
    /** The bell. "Ends at HH:MM (next bell)" prefills derive from this. */
    endTime: time('end_time').notNull(),
    policyId: uuid('policy_id').references(() => policies.id),
    joinCode: char('join_code', { length: 8 }).notNull(),
    requireApproval: boolean('require_approval').notNull().default(false),
    archivedAt: ts('archived_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('classes_join_code_uq').on(t.joinCode), index('classes_teacher_idx').on(t.teacherId)],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    label: text('label').notNull(),
    code: text('code').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    deactivatedAt: ts('deactivated_at'),
  },
  (t) => [uniqueIndex('tags_code_uq').on(t.code), index('tags_class_idx').on(t.classId)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    status: membershipStatusEnum('status').notNull().default('active'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    approvedAt: ts('approved_at'),
  },
  (t) => [
    uniqueIndex('memberships_class_student_uq').on(t.classId, t.studentId),
    index('memberships_student_idx').on(t.studentId),
  ],
);

// ---------- live ----------
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id),
    policyId: uuid('policy_id').references(() => policies.id),
    /** Frozen at start: { name, messagesAllowed, allowedAppLabels } — snapshot-only, no fallback. */
    policySnapshot: jsonb('policy_snapshot')
      .$type<{ name: string; messagesAllowed: boolean; allowedAppLabels: string[] }>()
      .notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    endsAt: ts('ends_at').notNull(),
    endedAt: ts('ended_at'),
    endReason: sessionEndReasonEnum('end_reason'),
  },
  (t) => [index('sessions_class_idx').on(t.classId), index('sessions_open_idx').on(t.classId, t.endedAt)],
);

export const participations = pgTable(
  'participations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    state: participantStateEnum('state').notNull().default('not_joined'),
    noDevice: boolean('no_device').notNull().default(false),
    tappedInAt: ts('tapped_in_at'),
    lastSeenAt: ts('last_seen_at'),
    /** Idempotency for offline-replayed tap-ins. */
    tapClientEventId: uuid('tap_client_event_id'),
  },
  (t) => [
    uniqueIndex('participations_session_student_uq').on(t.sessionId, t.studentId),
    index('participations_session_idx').on(t.sessionId),
  ],
);

export const passes = pgTable(
  'passes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    minutes: integer('minutes').notNull(),
    reason: text('reason'),
    grantedAt: ts('granted_at').notNull().defaultNow(),
    endsAt: ts('ends_at').notNull(),
    endedAt: ts('ended_at'),
  },
  (t) => [index('passes_session_idx').on(t.sessionId), index('passes_open_idx').on(t.endedAt)],
);

export const unlocks = pgTable(
  'unlocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    at: ts('at').notNull().defaultNow(),
    /** NULL = reason pending; students may share later or skip — both are first-class. */
    reason: unlockReasonEnum('reason'),
    reasonSharedAt: ts('reason_shared_at'),
    clientEventId: uuid('client_event_id'),
  },
  (t) => [
    uniqueIndex('unlocks_client_event_uq').on(t.clientEventId),
    index('unlocks_session_idx').on(t.sessionId),
    index('unlocks_at_idx').on(t.at),
  ],
);

// ---------- audit / timelines ----------
export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id),
    classId: uuid('class_id').references(() => classes.id),
    sessionId: uuid('session_id').references(() => sessions.id),
    studentId: uuid('student_id').references(() => students.id),
    teacherId: uuid('teacher_id').references(() => teachers.id),
    type: eventTypeEnum('type').notNull(),
    /** Self-contained denormalized payload (names, minutes, reasons) so history survives roster churn. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [
    index('events_school_at_idx').on(t.schoolId, t.at),
    index('events_session_idx').on(t.sessionId),
    index('events_class_at_idx').on(t.classId, t.at),
    index('events_student_at_idx').on(t.studentId, t.at),
  ],
);
