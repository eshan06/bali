'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import * as Dialog from '@radix-ui/react-dialog';
import { Bell, ChevronDown, Maximize2, Minimize2, Nfc, X } from 'lucide-react';
import type { EventDTO, SessionDetailDTO, ParticipantDTO } from '@bali/shared';
import { Arc } from '@/components/bali/Arc';
import { Button, Input, Label, Segmented, Toggle } from '@/components/bali/Button';
import { EventTimeline } from '@/components/bali/EventTimeline';
import { StatusChip, SummaryStrip, chipLabel } from '@/components/bali/StatusChip';
import { LoadError, ReconnectingPill } from '@/components/bali/bits';
import { ToastCard, useToasts } from '@/components/bali/Toaster';
import { ICON_STROKE } from '@/components/bali/icons';
import { api } from '@/lib/api';
import { useCountdown, useLiveSession, useSessionProgress } from '@/lib/live';
import { hhmm } from '@/lib/format';
import type { ClassCardDTO } from '@/lib/types';

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
  const { detail, reconnecting, liveLost, lastEvent, pulseStudentId } = useLiveSession(sessionId);
  const participants = useTickedParticipants(detail);
  const { toasts, push, dismiss } = useToasts();
  const [panelStudentId, setPanelStudentId] = useState<string | null>(null);
  const [endConfirm, setEndConfirm] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Surface a failed teacher action instead of swallowing it (docs/PRODUCTION.md #1).
  const actionFailed = useCallback(
    (title: string) => push({ id: 'action-error', variant: 'revoked', title, sub: 'Please try again.' }),
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
  const seenEvents = useRef(new Set<string>());
  useEffect(() => {
    if (!lastEvent || seenEvents.current.has(lastEvent.id)) return;
    seenEvents.current.add(lastEvent.id);
    const ev = lastEvent;
    // Match by stable studentId (duplicate display names otherwise misdirect or silently
    // drop the toast on a monitoring surface); fall back to name only if id is absent.
    const student = detail?.participants.find((p) =>
      ev.studentId ? p.studentId === ev.studentId : `${p.firstName} ${p.lastName}` === ev.studentName,
    );
    const at = hhmm(ev.at);
    if (ev.type === 'emergency_unlock' && student) {
      push({
        id: `unlock-${student.studentId}`,
        variant: 'emergency',
        title: `${student.shortName} used Emergency Unlock`,
        sub: `Reason pending · ${at}`,
        action: { label: 'Open student', onClick: () => setPanelStudentId(student.studentId) },
      });
    } else if (ev.type === 'reason_shared' && student) {
      const reason = ev.title.split('— ')[1] ?? 'Reason shared';
      push({
        id: `unlock-${student.studentId}`,
        variant: 'emergency',
        title: `${student.shortName} used Emergency Unlock`,
        sub: `${reason.replace('Reason: ', '').replace(/^skipped$/, 'Reason: skipped')} · ${at}`,
        action: { label: 'Open student', onClick: () => setPanelStudentId(student.studentId) },
      });
    } else if (ev.type === 'permission_revoked' && student) {
      push({
        id: `revoked-${student.studentId}`,
        variant: 'revoked',
        title: `${student.shortName} turned off Screen Time permission`,
        sub: 'Their shields are off',
        action: { label: 'Open student', onClick: () => setPanelStudentId(student.studentId) },
      });
    } else if (ev.type === 'pass_ended' && ev.studentName) {
      push({
        id: `passend-${ev.id}`,
        variant: 'info',
        title: `Pass ended for ${ev.studentName}`,
        sub: 'Shields returned automatically',
      });
    }
  }, [lastEvent, detail, push]);

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
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
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

/** State (c): inline start card — never a fake empty grid. */
function NoSessionState({
  cls,
  onStarted,
  onError,
}: {
  cls: ClassCardDTO;
  onStarted: (sessionId: string) => void;
  onError: (title: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Today's bell. If it has already passed, fall back to a bounded default (a class
  // period from now) instead of silently rolling to *tomorrow* — an after-bell start
  // must not create a ~24h session that shields every phone until the next day.
  const bellPassed = useMemo(() => {
    const [h = 0, m = 0] = cls.endTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d <= new Date();
  }, [cls.endTime]);
  const bellIso = useMemo(() => {
    const [h = 0, m = 0] = cls.endTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d <= new Date()) return new Date(Date.now() + 50 * 60_000); // 50-min default period
    return d;
  }, [cls.endTime]);

  const start = async () => {
    setBusy(true);
    try {
      const detail = await api.post<SessionDetailDTO>(`/classes/${cls.id}/sessions`, {
        endsAt: bellIso.toISOString(),
        policyId: cls.policyId ?? undefined,
      });
      onStarted(detail.session.id);
    } catch {
      onError('Couldn’t start the session');
    } finally {
      setBusy(false);
    }
  };

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
            <Label className="mb-1.5">Ends at</Label>
            <div className="flex items-center gap-2 rounded-sm border border-line-strong bg-surface-card px-3 py-[9px] text-[15px] leading-5">
              <Bell size={15} strokeWidth={ICON_STROKE} className="text-ink-tertiary" />
              <b className="tnum">{bellPassed ? hhmm(bellIso.toISOString()) : cls.endTime}</b>
              <span className="text-[13px] text-ink-tertiary">
                {bellPassed ? 'today’s bell passed · +50 min' : 'next bell'}
              </span>
              <ChevronDown size={14} strokeWidth={ICON_STROKE} className="ml-auto text-ink-tertiary" />
            </div>
          </div>
          <div className="flex-1">
            <Label className="mb-1.5">Policy</Label>
            <div className="flex items-center gap-2 rounded-sm border border-line-strong bg-surface-card px-3 py-[9px] text-[15px] leading-5">
              <b>{cls.policyName ?? 'Focus'}</b>
              <ChevronDown size={14} strokeWidth={ICON_STROKE} className="ml-auto text-ink-tertiary" />
            </div>
          </div>
        </div>
        <div className="text-[12.5px] leading-[17px] text-ink-tertiary">
          {cls.policyName ?? 'Focus'} · Full focus — students keep the apps they chose during setup
        </div>
        <Button className="self-start px-7 py-[11px]" loading={busy} onClick={() => void start()}>
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
  onError: (title: string) => void;
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
              Marks {participant.firstName} out of today&apos;s grid only
            </div>
          </div>
          <Toggle
            on={participant.state === 'no_device'}
            onChange={(next) =>
              void api
                .post(`/sessions/${sessionId}/no-device`, { studentId: participant.studentId, on: next })
                .catch(() => onError('Couldn’t update “no device”'))
            }
            ariaLabel="No device today"
          />
        </section>
      </div>
    </aside>
  );
}
