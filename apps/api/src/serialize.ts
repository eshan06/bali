import {
  deriveParticipantState,
  type ChipState,
  type EventDTO,
  type EventType,
  type ParticipantDTO,
  type SessionDTO,
  type SessionDetailDTO,
} from '@bali/shared';
import type { schema as s } from '@bali/db';

type SessionRow = typeof s.sessions.$inferSelect;
type ParticipationRow = typeof s.participations.$inferSelect;
type StudentRow = typeof s.students.$inferSelect;
type PassRow = typeof s.passes.$inferSelect;
type UnlockRow = typeof s.unlocks.$inferSelect;
type EventRow = typeof s.events.$inferSelect;

export const shortName = (firstName: string, lastName: string): string =>
  `${firstName} ${lastName.charAt(0).toUpperCase()}.`;

export function serializeSession(session: SessionRow, className: string): SessionDTO {
  return {
    id: session.id,
    classId: session.classId,
    className,
    policyName: session.policySnapshot.name,
    allowedAppLabels: session.policySnapshot.allowedAppLabels,
    messagesAllowed: session.policySnapshot.messagesAllowed,
    startedAt: session.startedAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
  };
}

export interface ParticipantSource {
  student: Pick<StudentRow, 'id' | 'firstName' | 'lastName'>;
  participation: ParticipationRow | null;
  activePass: PassRow | null;
  pendingUnlock: UnlockRow | null;
}

export function serializeParticipant(
  src: ParticipantSource,
  session: SessionRow,
  now: Date,
): ParticipantDTO {
  const derived = deriveParticipantState({
    storedState: src.participation?.state ?? null,
    noDevice: src.participation?.noDevice ?? false,
    passEndsAt: src.activePass && !src.activePass.endedAt ? src.activePass.endsAt : null,
    lastSeenAt: src.participation?.lastSeenAt ?? null,
    session: { endsAt: session.endsAt, endedAt: session.endedAt },
    now,
  });
  return {
    participationId: src.participation?.id ?? null,
    studentId: src.student.id,
    firstName: src.student.firstName,
    lastName: src.student.lastName,
    shortName: shortName(src.student.firstName, src.student.lastName),
    state: derived.state,
    passRemainingSeconds: derived.passRemainingSeconds,
    passEndsAt:
      derived.state === 'pass' && src.activePass ? src.activePass.endsAt.toISOString() : null,
    staleSeconds: derived.staleSeconds,
    isStale: derived.isStale,
    tappedInAt: src.participation?.tappedInAt?.toISOString() ?? null,
    pendingUnlockId: src.pendingUnlock?.id ?? null,
  };
}

export function countStates(participants: ParticipantDTO[]): SessionDetailDTO['counts'] {
  const counts: Record<ChipState, number> = {
    not_joined: 0,
    focused: 0,
    pass: 0,
    emergency_unlocked: 0,
    revoked: 0,
    no_device: 0,
    ended: 0,
  };
  for (const p of participants) counts[p.state] += 1;
  return counts;
}

// ---------- events ----------

const timeOf = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });

/** One renderer so every timeline (portal, W9, T3, S8, W4 panel) says it the same way.
 *  Vocabulary obeys the copy laws — "notified", never "reported"; no banned words. */
export function renderEvent(row: EventRow): EventDTO {
  const p = row.payload as Record<string, string | number | undefined>;
  const studentName = (p.studentName as string) ?? null;
  const className = (p.className as string) ?? null;
  const reasonText = p.reason ? `"${p.reason}"` : null;

  let title = '';
  let subtitle: string | null = null;

  switch (row.type) {
    case 'session_started':
      title = `Session started${p.tappedIn !== undefined ? ` · ${p.tappedIn} tapped in` : ''}`;
      subtitle = className;
      break;
    case 'session_extended':
      title = `Session extended · ${p.minutes} min`;
      subtitle = className;
      break;
    case 'session_ended':
      title = p.reason === 'bell' ? 'Session ended at the bell' : 'Session ended';
      subtitle = className;
      break;
    case 'tapped_in':
      title = `${studentName} tapped in`;
      subtitle = className;
      break;
    case 'pass_granted':
      title = `Pass granted to ${studentName} · ${p.minutes} min`;
      subtitle = [reasonText, className].filter(Boolean).join(' · ') || null;
      break;
    case 'pass_ended':
      title = `Pass ended for ${studentName}`;
      subtitle = 'Shields returned automatically';
      break;
    case 'emergency_unlock':
      title = `${studentName} — Emergency Unlock`;
      subtitle = ['reason pending', className].filter(Boolean).join(' · ');
      break;
    case 'reason_shared': {
      const reason = p.sharedReason === 'skipped' ? 'Reason: skipped' : `Reason: ${p.sharedReason}`;
      title = `${studentName} — ${reason}`;
      subtitle = className;
      break;
    }
    case 'refocused':
      title = `${studentName} re-focused`;
      subtitle = className;
      break;
    case 'permission_revoked':
      title = `${studentName} turned off Screen Time permission`;
      subtitle = 'Their shields are off';
      break;
    case 'permission_restored':
      title = `${studentName} turned Screen Time permission back on`;
      subtitle = className;
      break;
    case 'member_requested':
      title = `${studentName} asked to join`;
      subtitle = className;
      break;
    case 'member_joined':
      title = `${studentName} joined`;
      subtitle = className;
      break;
    case 'member_approved':
      title = `${studentName} approved`;
      subtitle = className;
      break;
    case 'member_declined':
      title = `${studentName} declined`;
      subtitle = className;
      break;
    case 'member_removed':
      title = `${studentName} removed`;
      subtitle = className;
      break;
    case 'no_device_set':
      title = `${studentName} marked: no device today`;
      subtitle = className;
      break;
    case 'no_device_cleared':
      title = `No-device cleared for ${studentName}`;
      subtitle = className;
      break;
    case 'tag_created':
      title = `Tag "${p.label}" is live`;
      subtitle = className;
      break;
    case 'tag_deactivated':
      title = `Tag "${p.label}" deactivated`;
      subtitle = className;
      break;
    default: {
      const _exhaustive: never = row.type;
      title = String(_exhaustive);
    }
  }

  return {
    id: String(row.id),
    type: row.type as EventType,
    at: row.at.toISOString(),
    classId: row.classId,
    sessionId: row.sessionId,
    studentName,
    className,
    title,
    subtitle,
  };
}

export { timeOf };
