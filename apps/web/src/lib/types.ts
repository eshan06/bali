import type { ParticipantDTO } from '@bali/shared';

export interface ClassCardDTO {
  id: string;
  name: string;
  daysLabel: string;
  startTime: string;
  endTime: string;
  joinCode: string;
  requireApproval: boolean;
  memberCount: number;
  policyId: string | null;
  policyName: string | null;
  allowedAppLabels: string[];
  live: { sessionId: string; endsAt: string; endsAtLabel: string } | null;
}

export interface PolicyDTO {
  id: string;
  name: string;
  messagesAllowed: boolean;
  allowedAppLabels: string[];
  usedByClasses: number;
}

export interface RosterDTO {
  class: ClassCardDTO;
  members: Array<{
    membershipId: string;
    studentId: string;
    name: string;
    joinedAt: string;
    current: ParticipantDTO | null;
  }>;
  pending: Array<{ membershipId: string; studentId: string; name: string; requestedAt: string }>;
}
