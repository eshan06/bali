'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArcMark } from '@/components/bali/ArcMark';
import { Button, Input, Label, Toggle } from '@/components/bali/Button';
import { JoinCodeBadge, CopyButton, ErrorToast, LoadError } from '@/components/bali/bits';
import { ProjectCodeOverlay, ProjectThisButton } from '@/components/bali/ProjectCode';
import { StatusChip } from '@/components/bali/StatusChip';
import { ICON_STROKE } from '@/components/bali/icons';
import { api } from '@/lib/api';
import type { ClassCardDTO, PolicyDTO } from '@/lib/types';

const hhmm12 = (t: string) => {
  const [h = 0, m = 0] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '');
};

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassCardDTO[] | null>(null);
  const [policies, setPolicies] = useState<PolicyDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<ClassCardDTO | null>(null);
  const [projecting, setProjecting] = useState(false);

  // create form
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('11:00');
  const [endTime, setEndTime] = useState('11:45');
  const [policyId, setPolicyId] = useState<string>('');
  const [requireApproval, setRequireApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    void api
      .get<{ classes: ClassCardDTO[] }>('/classes')
      .then((r) => setClasses(r.classes))
      .catch(() => setLoadError(true));
    void api
      .get<{ policies: PolicyDTO[] }>('/policies')
      .then((r) => {
        setPolicies(r.policies);
        setPolicyId((prev) => prev || (r.policies.find((p) => p.usedByClasses > 0) ?? r.policies[0])?.id || '');
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const cls = await api.post<ClassCardDTO>('/classes', {
        name,
        daysLabel: 'Mon–Fri',
        startTime,
        endTime,
        policyId: policyId || undefined,
        requireApproval,
      });
      setCreated(cls);
      setName('');
      load();
    } catch {
      setActionError('Couldn’t create the class. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const selectedPolicy = policies.find((p) => p.id === policyId);
  const mostUsedId = policies.reduce<PolicyDTO | null>(
    (best, p) => (best === null || p.usedByClasses > best.usedByClasses ? p : best),
    null,
  )?.id;

  return (
    <div className="mx-auto flex max-w-[1190px] flex-col gap-[18px] px-8 pb-9 pt-6">
      <div className="flex items-center gap-4">
        <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.01em]">Classes</h1>
        <div className="ml-auto">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <Plus size={16} strokeWidth={ICON_STROKE} />
            New class
          </Button>
        </div>
      </div>

      {classes === null ? (
        loadError ? (
          <LoadError what="your classes" onRetry={load} />
        ) : (
          <div className="text-ink-tertiary">Loading…</div>
        )
      ) : classes.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-[60px] text-center">
          <svg viewBox="0 0 20 20" fill="none" className="h-14 w-14">
            <circle cx="10" cy="10" r="7.5" stroke="var(--stone-200)" strokeWidth="3" />
          </svg>
          <div className="text-[20px] font-semibold leading-[26px]">Set up your first class</div>
          <div className="max-w-[380px] text-[14px] leading-[21px] text-ink-secondary">
            Name it, pick a policy, and put the join code on the board. Desk tags can come later —
            students can always join by code.
          </div>
          <Button className="px-[26px] py-[11px]" onClick={() => setOpen(true)}>
            <Plus size={16} strokeWidth={ICON_STROKE} />
            Create a class
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {classes.map((cls) => (
            <div key={cls.id} className="flex items-center gap-4 rounded-md border border-line bg-surface-card p-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5 text-[17px] font-semibold leading-[23px]">
                  {cls.name}
                  {cls.live ? (
                    <StatusChip state="focused" size="mini" label={`Live · ends ${cls.live.endsAtLabel}`} />
                  ) : null}
                </div>
                <div className="mt-[3px] text-[13px] leading-[18px] text-ink-secondary">
                  {cls.memberCount} students
                  {cls.policyName ? ` · ${cls.policyName} policy` : ''}
                  {cls.live ? ` · session ends ${cls.live.endsAtLabel}` : ` · next session ${hhmm12(cls.startTime)}`}
                </div>
              </div>
              {cls.live ? (
                <>
                  <Link href={`/app/classes/${cls.id}/live`}>
                    <Button>Open live grid</Button>
                  </Link>
                  <Link href={`/app/classes/${cls.id}/roster`}>
                    <Button variant="secondary">Roster</Button>
                  </Link>
                </>
              ) : (
                <>
                  <Link href={`/app/classes/${cls.id}/roster`}>
                    <Button variant="ghost">Roster</Button>
                  </Link>
                  <Link href={`/app/classes/${cls.id}/live`} aria-label={`Open ${cls.name}`}>
                    <ChevronRight size={16} strokeWidth={ICON_STROKE} className="text-ink-tertiary" />
                  </Link>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create dialog — two prefilled decisions + a name. */}
      <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setCreated(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-30 bg-[rgba(22,19,16,0.42)]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[31] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface-card p-6 shadow-3 focus:outline-none"
            aria-describedby={undefined}
          >
            {created ? (
              <div className="flex flex-col items-center gap-3.5 pt-2 text-center">
                <span className="relative inline-flex">
                  <ArcMark size={44} />
                </span>
                <Dialog.Title className="text-[19px] font-semibold leading-[25px]">
                  {created.name} is ready
                </Dialog.Title>
                <p className="max-w-[340px] text-[14px] leading-5 text-ink-secondary">
                  Put the join code on the board — students join from the Bali iOS app.
                </p>
                <JoinCodeBadge code={created.joinCode} size="card" />
                <div className="flex gap-2">
                  <CopyButton text={created.joinCode} />
                  <ProjectThisButton onClick={() => setProjecting(true)} />
                </div>
                <Button className="mt-1.5 w-full py-[11px]" onClick={() => { setOpen(false); setCreated(null); }}>
                  Done
                </Button>
                <p className="text-[12.5px] leading-[17px] text-ink-tertiary">
                  Desk tags are optional — add them any time from Tags.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3.5">
                <Dialog.Title className="text-[19px] font-semibold leading-[25px]">New class</Dialog.Title>
                <div>
                  <Label className="mb-1.5">Class name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Period 4 — Precalculus" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Label className="mb-1.5">Meets</Label>
                    <div className="flex items-center gap-1.5">
                      <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                      <span className="text-ink-tertiary">–</span>
                      <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex-1">
                    <Label className="mb-1.5">Policy</Label>
                    {policies.length === 0 ? (
                      <div className="rounded-sm border border-line bg-surface-sunken px-3 py-[9px] text-[13px] leading-5 text-ink-secondary">
                        Runs Full Focus by default
                      </div>
                    ) : (
                      <select
                        className="w-full rounded-sm border border-line-strong bg-surface-card px-3 py-[9px] text-[15px] leading-5"
                        value={policyId}
                        onChange={(e) => setPolicyId(e.target.value)}
                      >
                        {policies.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.id === mostUsedId ? ' · most used' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                {policies.length === 0 ? (
                  <div className="text-[12.5px] leading-[17px] text-ink-tertiary">
                    Every session is Full Focus. Name a reusable policy any time from Policies.
                  </div>
                ) : selectedPolicy ? (
                  <div className="text-[12.5px] leading-[17px] text-ink-tertiary">
                    {selectedPolicy.name} · Full focus
                  </div>
                ) : null}
                <div className="flex items-center gap-3 border-t border-line pt-3.5">
                  <div className="flex-1">
                    <div className="text-[14px] font-medium leading-[19px]">Require approval to join</div>
                    <div className="text-[12.5px] leading-[17px] text-ink-tertiary">
                      Otherwise the code admits anyone who has it
                    </div>
                  </div>
                  <Toggle on={requireApproval} onChange={setRequireApproval} ariaLabel="Require approval to join" />
                </div>
                <div className="mt-1 flex justify-end gap-2.5">
                  <Dialog.Close asChild>
                    <Button variant="ghost" className="text-ink-secondary">
                      Cancel
                    </Button>
                  </Dialog.Close>
                  <Button className="px-[22px]" disabled={!name.trim()} loading={busy} onClick={() => void create()}>
                    Create class
                  </Button>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {projecting && created ? (
        <ProjectCodeOverlay
          code={created.joinCode}
          className={created.name}
          onClose={() => setProjecting(false)}
        />
      ) : null}

      {actionError ? <ErrorToast message={actionError} onDismiss={() => setActionError(null)} /> : null}
    </div>
  );
}
