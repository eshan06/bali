'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import * as Dialog from '@radix-ui/react-dialog';
import { Maximize2, Minimize2, Nfc, X } from 'lucide-react';
import type { EventDTO, SessionDetailDTO, ParticipantDTO } from '@bali/shared';
import { Arc } from '@/components/bali/Arc';
import { Button, Input, Label, Segmented, Toggle } from '@/components/bali/Button';
import { EventTimeline } from '@/components/bali/EventTimeline';
import { StatusChip, SummaryStrip, chipLabel } from '@/components/bali/StatusChip';
import { LoadError, ReconnectingPill } from '@/components/bali/bits';
import { ToastCard, useToasts, type ToastItem } from '@/components/bali/Toaster';
import { ICON_STROKE } from '@/components/bali/icons';
import { ApiError, api } from '@/lib/api';
import { useCountdown, useLiveSession, useSessionProgress } from '@/lib/live';
import { hhmm } from '@/lib/format';
import type { ClassCardDTO, PolicyDTO } from '@/lib/types';

/** Local "HH:MM" for an <input type="time">. */
const clockValue = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * The server's own words for a deliberate refusal (4xx), so the teacher reads *why* the
 * write was rejected instead of a "try again" that will fail identically forever. A 5xx or
 * a transport failure has nothing specific to say, so those keep the generic advice.
 */
function refusalMessage(err: unknown): string | undefined {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : undefined;
}

/** Tick pass countdowns locally between server pushes. */
function useTickedParticipants(detail: SessionDetailDTO | null): ParticipantDTO[] {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => {
    if (!detail) return [];
    const receivedAt = Date.now();
    void receivedAt;
    return detail.participants.map((p) => {
      if (p.state === 'pass' && p.passEndsAt) {
        const remain = Math.max(0, Math.floor((new Date(p.passEndsAt).getTime() - Date.now()) / 1000));
        return { ...p, passRemainingSeconds: remain };
      }
      return p;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, Math.floor(Date.now() / 1000)]);
}

export default function LivePage() {
  const { id: classId } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const projector = search.get('projector') === '1';

  const [cls, setCls] = useState<ClassCardDTO | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { detail, reconnecting, liveLost, events, pulseStudentId } = useLiveSession(sessionId);
  const participants = useTickedParticipants(detail);
  const { toasts, push, dismiss } = useToasts();
  const [panelStudentId, setPanelStudentId] = useState<string | null>(null);
  const [endConfirm, setEndConfirm] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Surface a failed teacher action instead of swallowing it (docs/PRODUCTION.md #1).
  // `detail` carries the server's own explanation of a deliberate refusal; telling the
  // teacher to "try again" when the server will never accept the write is a lie.
  const actionFailed = useCallback(
    (title: string, detail?: string) =>
      push({ id: 'action-error', variant: 'revoked', title, sub: detail ?? 'Please try again.' }),
    [push],
  );

  const loadClass = useCallback(() => {
    setLoadError(false);
    void api
      .get<ClassCardDTO>(`/classes/${classId}`)
      .then((c) => {
        setCls(c);
        setSessionId(c.live?.sessionId ?? null);
      })
      .catch(() => setLoadError(true));
  }, [classId]);
  useEffect(loadClass, [loadClass]);

  // session ended remotely → fall back to the no-session state
  useEffect(() => {
    if (detail?.session.endedAt) {
      setSessionId(null);
      setPanelStudentId(null);
      loadClass();
    }
  }, [detail?.session.endedAt, loadClass]);

  // SSE events → toasts (sticky emergency/revoked; info auto-dismiss)
  // Two sets, not one: an event counts as handled only once it has actually been
  // surfaced. `settled` holds events shown in their full form; `degraded` holds events
  // shown without a roster match (a student removed mid-session can still record an
  // emergency unlock, and getSessionDetail lists active memberships only). Those stay
  // re-checkable so a participant frame arriving later upgrades the same toast in place.
  const settledEvents = useRef(new Set<string>());
  const degradedEvents = useRef(new Set<string>());
  // Cards the teacher has closed. push() updates a card with the same id *in place*, so an
  // upgrade is only an upgrade while that card is on screen; once it is dismissed the same
  // call re-opens it, which is how a dismissed toast comes back the moment a participant
  // frame arrives. Remembering the dismissal is what makes "update in place" true.
  const dismissedToasts = useRef(new Set<string>());
  const seenSessionId = useRef<string | null>(null);
  const dismissToast = useCallback(
    (id: string) => {
      dismissedToasts.current.add(id);
      dismiss(id);
    },
    [dismiss],
  );
  useEffect(() => {
    // Seen-ids are session-scoped — otherwise the sets grow for the life of the tab.
    if (seenSessionId.current !== sessionId) {
      seenSessionId.current = sessionId;
      settledEvents.current.clear();
      degradedEvents.current.clear();
      dismissedToasts.current.clear();
    }
    // Drain the whole queue, oldest first — several frames can arrive in one chunk and
    // land in a single React batch, and reading one slot would toast only the last.
    // The refs still guarantee one toast per event across re-renders and server replays.
    for (const ev of events) {
      // A frame left over from the previous session (the queue clears asynchronously).
      if (ev.sessionId && ev.sessionId !== sessionId) continue;
      if (settledEvents.current.has(ev.id)) continue;
      // Match by stable studentId (duplicate display names otherwise misdirect or silently
      // drop the toast on a monitoring surface); fall back to name only if id is absent.
      const student = detail?.participants.find((p) =>
        ev.studentId ? p.studentId === ev.studentId : `${p.firstName} ${p.lastName}` === ev.studentName,
      );
      const built = eventToast(ev, student ?? null, setPanelStudentId);
      if (!built) {
        // Nothing to show for this type — handled by being ignored, not by being dropped.
        settledEvents.current.add(ev.id);
        continue;
      }
      if (degradedEvents.current.has(ev.id)) {
        // Surfaced once already in its degraded form. Re-push only to upgrade a card the
        // teacher can still see: while it stays unmatched there is nothing new to say, and
        // once it has been dismissed the "upgrade" would just resurrect it. The event is
        // settled either way — it was shown, and the teacher closed it.
        if (!built.final) continue;
        if (dismissedToasts.current.has(built.toast.id)) {
          settledEvents.current.add(ev.id);
          degradedEvents.current.delete(ev.id);
          continue;
        }
      }
      push(built.toast);
      // A *new* event is new information and legitimately opens the card again (a shared
      // reason after a dismissed unlock); from here it is on screen, so it can be upgraded.
      dismissedToasts.current.delete(built.toast.id);
      if (built.final) {
        settledEvents.current.add(ev.id);
        degradedEvents.current.delete(ev.id);
      } else {
        degradedEvents.current.add(ev.id);
      }
    }
  }, [events, detail, push, sessionId]);

  const countdown = useCountdown(detail?.session.endsAt);
  const pct = useSessionProgress(detail?.session.startedAt, detail?.session.endsAt);

  if (!cls)
    return loadError ? (
      <div className="p-9">
        <LoadError what="this class" onRetry={loadClass} />
      </div>
    ) : (
      <div className="p-9 text-ink-tertiary">Loading…</div>
    );

  // ---------- state (c): no active session ----------
  if (!sessionId || !detail) {
    return <NoSessionState cls={cls} onStarted={(sid) => setSessionId(sid)} onError={actionFailed} />;
  }

  const counts = detail.counts;
  const zeroIn = counts.focused + counts.pass + counts.emergency_unlocked + counts.revoked === 0;
  const panelStudent = participants.find((p) => p.studentId === panelStudentId) ?? null;
  const chipSize = projector ? 'proj' : 'grid';

  const grid = (
    <div
      role="list"
      aria-label={`Live status, ${participants.length} students`}
      className={clsx(
        'grid',
        projector ? 'grid-cols-4 gap-3.5' : 'grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4',
      )}
    >
      {participants.map((p) => (
        <span role="listitem" key={p.studentId} className="min-w-0 [&>*]:w-full [&>*]:justify-start">
          <StatusChip
            state={p.state}
            name={p.shortName}
            label={chipLabel(p)}
            size={chipSize}
            stale={p.isStale ? p.staleSeconds : null}
            selected={panelStudentId === p.studentId}
            pulse={pulseStudentId === p.studentId && p.state === 'emergency_unlocked'}
            onClick={projector ? undefined : () => setPanelStudentId(p.studentId)}
          />
        </span>
      ))}
    </div>
  );

  // ---------- state (f): projector ----------
  if (projector) {
    return (
      <div className="fixed inset-0 z-40 overflow-auto bg-surface-page">
        <div className="flex flex-col gap-[18px] px-12 py-9">
          <div className="flex items-center gap-[22px]">
            <Arc size={56} stroke={6} pct={pct} />
            <div>
              <h1 className="text-[36px] font-semibold leading-[42px] tracking-[-0.01em]">
                {detail.session.className}
              </h1>
              <div className="mt-0.5 text-[16px] text-ink-secondary">
                {detail.session.policyName} · Full focus
              </div>
            </div>
            <div className="ml-auto flex items-center gap-5">
              <div className="text-right">
                <div className="font-num text-[44px] font-semibold leading-[48px] tnum">{countdown}</div>
                <div className="text-[15px] text-ink-secondary">ends {hhmm(detail.session.endsAt)}</div>
              </div>
              <button
                type="button"
                aria-label="Exit projector mode"
                className="rounded-md p-2 text-ink-tertiary hover:bg-surface-sunken"
                onClick={() => router.replace(`/app/classes/${classId}/live`)}
              >
                <Minimize2 size={22} strokeWidth={ICON_STROKE} />
              </button>
            </div>
          </div>
          <SummaryStrip counts={counts} size="grid" />
          {grid}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      {/* Transport status — pinned top-center. A brief blip shows the calm pill; a
          sustained failure escalates to a loud banner, because a silently-frozen grid
          on a monitoring surface is a safety gap. */}
      {liveLost ? (
        <div
          role="alert"
          className="absolute left-1/2 top-3.5 z-[36] flex -translate-x-1/2 items-center gap-3 rounded-md bg-red-600 px-4 py-2.5 text-[13px] font-medium text-white shadow-3"
        >
          Live updates lost — this grid may be out of date.
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      ) : reconnecting ? (
        <div className="absolute left-1/2 top-3.5 z-[36] -translate-x-1/2">
          <ReconnectingPill />
        </div>
      ) : null}

      {/* toast stack: top-right 18px; docks left of the panel and below the header when open */}
      <div
        className="absolute z-40 flex flex-col gap-2.5"
        style={panelStudent ? { right: 390, top: 150 } : { right: 18, top: 18 }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </div>

      <div className="mx-auto flex max-w-[1190px] flex-col gap-[18px] px-8 pb-9 pt-6">
        {/* header */}
        <div className="flex items-center gap-[18px]">
          <Arc size={44} stroke={5} pct={pct} />
          <div>
            <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.01em]">{detail.session.className}</h1>
            <div className="text-[13px] leading-[18px] text-ink-secondary">
              {detail.session.policyName} · Full focus
            </div>
          </div>
          <div className="ml-3 flex items-center gap-3">
            <div>
              <div className="font-num text-[28px] font-semibold leading-8 tnum">{countdown}</div>
              <div className="text-[12.5px] leading-[17px] text-ink-secondary">
                ends {hhmm(detail.session.endsAt)}
              </div>
            </div>
          </div>
          <div className="ml-auto flex gap-2.5">
            <Button
              variant="secondary"
              onClick={() =>
                void api
                  .post(`/sessions/${sessionId}/extend`, { minutes: 5 })
                  .catch(() => actionFailed('Couldn’t extend the session'))
              }
              title="Extend 5 minutes"
            >
              Extend
            </Button>
            <Button variant="quiet-destructive" onClick={() => setEndConfirm(true)}>
              End session…
            </Button>
            <Link
              href={`/app/classes/${classId}/live?projector=1`}
              className="inline-flex items-center rounded-sm border border-line-strong bg-surface-card px-3 text-ink-secondary hover:bg-surface-sunken"
              aria-label="Projector mode"
              title="Projector mode"
            >
              <Maximize2 size={16} strokeWidth={ICON_STROKE} />
            </Link>
          </div>
        </div>

        <SummaryStrip counts={counts} />

        {/* state (d): live, 0 tapped in */}
        {zeroIn ? (
          <div className="flex items-center gap-2.5 pb-0.5 pt-2.5 text-[14px] leading-[19px] text-ink-secondary">
            <Nfc size={16} strokeWidth={ICON_STROKE} className="text-ink-tertiary" />
            Students tap the desk tag to start — names light up here as they join.
          </div>
        ) : null}

        {grid}
      </div>

      {/* StudentPanel slide-over */}
      {panelStudent && sessionId ? (
        <StudentPanel
          sessionId={sessionId}
          participant={panelStudent}
          onClose={() => setPanelStudentId(null)}
          onError={actionFailed}
        />
      ) : null}

      {/* End session confirm — destructive confirms before acting */}
      <Dialog.Root open={endConfirm} onOpenChange={setEndConfirm}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(22,19,16,0.42)]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface-card p-6 shadow-3 focus:outline-none">
            <Dialog.Title className="text-[18px] font-semibold leading-6">End this session?</Dialog.Title>
            <Dialog.Description className="mt-2 text-[14px] leading-5 text-ink-secondary">
              Shields lift for everyone and the grid closes. Students keep their own history.
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2.5">
              <Dialog.Close asChild>
                <Button variant="ghost" className="text-ink-secondary">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                variant="destructive"
                onClick={() => {
                  void api
                    .post(`/sessions/${sessionId}/end`)
                    .then(() => setEndConfirm(false))
                    .catch(() => {
                      setEndConfirm(false);
                      actionFailed('Couldn’t end the session');
                    });
                }}
              >
                End session
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/**
 * One toast per event, whether or not the student is still in the live grid. A student
 * removed mid-session can still record an emergency unlock (the server accepts it on
 * purpose — the exit is always theirs), and the grid is built from active memberships
 * only, so that unlock matches nobody: it is still shown, named from the event itself
 * and marked as off the grid, because a dropped emergency toast is a safety gap.
 * `final: false` means the card was degraded by the missing participant and should be
 * rebuilt if that participant shows up (push() updates a card with the same id in place).
 */
function eventToast(
  ev: EventDTO,
  student: ParticipantDTO | null,
  openStudent: (studentId: string) => void,
): { toast: ToastItem; final: boolean } | null {
  const at = hhmm(ev.at);
  const name = student?.shortName ?? ev.studentName ?? 'A student';
  // Only what this page actually knows: they are not in the grid it is rendering.
  const offGrid = student ? null : 'Not in the live grid';
  // No chip to open, so no "Open student" link that would do nothing.
  const action = student
    ? { label: 'Open student', onClick: () => openStudent(student.studentId) }
    : null;
  // Keyed per student so a follow-up reason updates the same emergency card.
  const key = ev.studentId ?? student?.studentId ?? ev.id;

  switch (ev.type) {
    case 'emergency_unlock':
      return {
        toast: {
          id: `unlock-${key}`,
          variant: 'emergency',
          title: `${name} used Emergency Unlock`,
          sub: `${offGrid ?? 'Reason pending'} · ${at}`,
          action,
        },
        final: student !== null,
      };
    case 'reason_shared': {
      const reason = ev.title.split('— ')[1] ?? 'Reason shared';
      const line = reason.replace('Reason: ', '').replace(/^skipped$/, 'Reason: skipped');
      return {
        toast: {
          id: `unlock-${key}`,
          variant: 'emergency',
          title: `${name} used Emergency Unlock`,
          sub: [line, offGrid, at].filter(Boolean).join(' · '),
          action,
        },
        final: student !== null,
      };
    }
    case 'permission_revoked':
      return {
        toast: {
          id: `revoked-${key}`,
          variant: 'revoked',
          title: `${name} turned off Screen Time permission`,
          sub: offGrid ? `Their shields are off · ${offGrid}` : 'Their shields are off',
          action,
        },
        final: student !== null,
      };
    case 'pass_ended':
      // Reads off the event alone, so the roster never gates it.
      return ev.studentName
        ? {
            toast: {
              id: `passend-${ev.id}`,
              variant: 'info',
              title: `Pass ended for ${ev.studentName}`,
              sub: 'Shields returned automatically',
            },
            final: true,
          }
        : null;
    default:
      return null;
  }
}

/** State (c): inline start card — never a fake empty grid. */
function NoSessionState({
  cls,
  onStarted,
  onError,
}: {
  cls: ClassCardDTO;
  onStarted: (sessionId: string) => void;
  onError: (title: string, detail?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [policies, setPolicies] = useState<PolicyDTO[]>([]);
  const [policyId, setPolicyId] = useState(cls.policyId ?? '');
  // Today's bell. If it has already passed, prefill a bounded default (a class period
  // from now) instead of silently rolling to *tomorrow* — an after-bell start must not
  // create a ~24h session that shields every phone until the next day.
  const bellPassed = useMemo(() => {
    const [h = 0, m = 0] = cls.endTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d <= new Date();
  }, [cls.endTime]);
  const [endTime, setEndTime] = useState(() =>
    bellPassed ? clockValue(new Date(Date.now() + 50 * 60_000)) : cls.endTime,
  );
  const endsAt = useMemo(() => {
    const [h = 0, m = 0] = endTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }, [endTime]);
  // A time earlier than now is always today's past, never tomorrow (see above).
  const endsInPast = endsAt <= new Date();

  useEffect(() => {
    void api
      .get<{ policies: PolicyDTO[] }>('/policies')
      .then((r) => {
        setPolicies(r.policies);
        setPolicyId((prev) => prev || r.policies[0]?.id || '');
      })
      .catch(() => {});
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const detail = await api.post<SessionDetailDTO>(`/classes/${cls.id}/sessions`, {
        endsAt: endsAt.toISOString(),
        policyId: policyId || undefined,
      });
      onStarted(detail.session.id);
    } catch {
      onError('Couldn’t start the session');
    } finally {
      setBusy(false);
    }
  };

  const policyName = policies.find((p) => p.id === policyId)?.name ?? cls.policyName ?? 'Focus';

  return (
    <div className="mx-auto flex max-w-[1190px] flex-col gap-[18px] px-8 pb-9 pt-6">
      <div className="flex items-center gap-[18px]">
        <div>
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.01em]">{cls.name}</h1>
          <div className="text-[13px] leading-[18px] text-ink-secondary">
            {cls.memberCount} students · no session running
          </div>
        </div>
        <div className="ml-auto">
          <Link href={`/app/classes/${cls.id}/roster`}>
            <Button variant="secondary">Roster</Button>
          </Link>
        </div>
      </div>

      <div className="mt-2 flex max-w-[560px] flex-col gap-3.5 rounded-md border border-line bg-surface-card p-5">
        <div className="text-[18px] font-semibold leading-6">Start a session</div>
        <div className="flex gap-3">
          <div className="flex-1">
            <Label className="mb-1.5" htmlFor="ends-at">
              Ends at
            </Label>
            <Input
              id="ends-at"
              type="time"
              value={endTime}
              error={endsInPast}
              onChange={(e) => setEndTime(e.target.value)}
            />
            <div className="mt-1 text-[12.5px] leading-[17px] text-ink-tertiary">
              {endsInPast
                ? 'Pick a time later today'
                : endTime === cls.endTime
                  ? 'next bell'
                  : `${Math.round((endsAt.getTime() - Date.now()) / 60_000)} min from now`}
            </div>
          </div>
          <div className="flex-1">
            <Label className="mb-1.5" htmlFor="policy">
              Policy
            </Label>
            {policies.length === 0 ? (
              <div className="rounded-sm border border-line bg-surface-sunken px-3 py-[9px] text-[15px] leading-5 text-ink-secondary">
                {policyName}
              </div>
            ) : (
              <select
                id="policy"
                className="w-full rounded-sm border border-line-strong bg-surface-card px-3 py-[9px] text-[15px] leading-5"
                value={policyId}
                onChange={(e) => setPolicyId(e.target.value)}
              >
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="text-[12.5px] leading-[17px] text-ink-tertiary">
          {policyName} · Full focus — students keep the apps they chose during setup
        </div>
        <Button
          className="self-start px-7 py-[11px]"
          disabled={endsInPast}
          loading={busy}
          onClick={() => void start()}
        >
          Start session
        </Button>
      </div>
      <div className="mt-1.5 text-[13px] leading-[18px] text-ink-tertiary">
        When it starts, {cls.memberCount} students can tap the desk tag to focus. Sessions end automatically at the
        bell.
      </div>
    </div>
  );
}

/** 372px right slide-over: timeline · grant-a-pass · no-device. */
function StudentPanel({
  sessionId,
  participant,
  onClose,
  onError,
}: {
  sessionId: string;
  participant: ParticipantDTO;
  onClose: () => void;
  onError: (title: string, detail?: string) => void;
}) {
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [preset, setPreset] = useState<'5' | '10' | '15' | 'custom'>('10');
  const [customMin, setCustomMin] = useState('20');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .get<{ events: EventDTO[] }>(`/sessions/${sessionId}/students/${participant.studentId}/timeline`)
      .then((r) => setEvents(r.events));
  }, [sessionId, participant.studentId, participant.state]);

  const minutes = preset === 'custom' ? Math.max(1, parseInt(customMin, 10) || 10) : parseInt(preset, 10);
  const canPass = participant.state === 'focused';
  // The server refuses "no device" over anyone whose participation is open or closed — a
  // tap-in is proof of a device, and a closed row is the truth (domain.setNoDevice 409s).
  // `not_joined` is exactly the case it accepts; clearing the flag is always allowed, so
  // only the off→on direction is gated.
  const noDeviceOn = participant.state === 'no_device';
  const canMarkNoDevice = participant.state === 'not_joined';

  const grant = async () => {
    setBusy(true);
    try {
      await api.post(`/sessions/${sessionId}/passes`, {
        studentId: participant.studentId,
        minutes,
        reason: reason.trim() || undefined,
      });
      setReason('');
    } catch {
      onError('Couldn’t grant the pass');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="fixed bottom-0 right-0 top-0 z-[35] w-[372px] overflow-y-auto border-l border-line bg-surface-card">
      <div className="flex items-center gap-3 border-b border-line px-5 pb-3.5 pt-[18px]">
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold leading-6">
            {participant.firstName} {participant.lastName}
          </div>
          <div className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">
            {participant.tappedInAt ? `tapped in ${hhmm(participant.tappedInAt)} · iPhone` : 'not tapped in yet'}
          </div>
        </div>
        <StatusChip state={participant.state} size="mini" label={chipLabel(participant)} />
        <button type="button" aria-label="Close" onClick={onClose} className="text-ink-tertiary hover:text-ink-secondary">
          <X size={16} strokeWidth={ICON_STROKE} />
        </button>
      </div>

      <div className="flex flex-col gap-5 px-5 py-[18px]">
        <section>
          <h4 className="mb-2.5 text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-ink-tertiary">
            This session
          </h4>
          {events.length ? (
            <EventTimeline events={events} />
          ) : (
            <div className="text-[13px] text-ink-tertiary">Nothing yet — they haven&apos;t tapped in.</div>
          )}
        </section>

        <section>
          <h4 className="mb-2.5 text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-ink-tertiary">
            Grant a pass
          </h4>
          <div className="flex flex-col gap-2">
            <Segmented
              options={[
                { value: '5', label: '5' },
                { value: '10', label: '10' },
                { value: '15', label: '15' },
                { value: 'custom', label: 'Custom' },
              ]}
              value={preset}
              onChange={setPreset}
            />
            {preset === 'custom' ? (
              <Input
                type="number"
                min={1}
                max={60}
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
                aria-label="Custom minutes"
              />
            ) : null}
            <Input
              placeholder="Reason (optional) — e.g. nurse"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button disabled={!canPass} loading={busy} onClick={() => void grant()}>
              Grant {minutes}-minute pass
            </Button>
            <span className="text-[12.5px] leading-[17px] text-ink-tertiary">
              {canPass ? 'Shields return automatically when it ends.' : 'Passes go to students who are focused.'}
            </span>
          </div>
        </section>

        <section className="flex items-center gap-3 border-t border-line pt-4">
          <div className="flex-1">
            <div className="text-[14px] font-medium leading-[19px]">No device today</div>
            <div className="text-[12.5px] leading-[17px] text-ink-tertiary">
              {noDeviceOn || canMarkNoDevice
                ? `Marks ${participant.firstName} out of today’s grid only`
                : participant.tappedInAt
                  ? 'Only for students who never tapped in'
                  : 'This session is already closed for them'}
            </div>
          </div>
          <Toggle
            on={noDeviceOn}
            disabled={!noDeviceOn && !canMarkNoDevice}
            onChange={(next) =>
              void api
                .post(`/sessions/${sessionId}/no-device`, { studentId: participant.studentId, on: next })
                .catch((err) => onError('Couldn’t update “no device”', refusalMessage(err)))
            }
            ariaLabel="No device today"
          />
        </section>
      </div>
    </aside>
  );
}
