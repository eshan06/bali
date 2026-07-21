'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { ParentLinkDTO } from '@bali/shared';
import { Button } from '@/components/bali/Button';
import { JoinCodeBadge, CopyButton, Card, ErrorToast, LoadError } from '@/components/bali/bits';
import { ProjectCodeOverlay, ProjectThisButton } from '@/components/bali/ProjectCode';
import { StatusChip, chipLabel } from '@/components/bali/StatusChip';
import { ICON_STROKE } from '@/components/bali/icons';
import { api } from '@/lib/api';
import type { RosterDTO } from '@/lib/types';

/** W5 · Roster — pending approvals float above the members table; join code right. */
export default function RosterPage() {
  const { id: classId } = useParams<{ id: string }>();
  const [roster, setRoster] = useState<RosterDTO | null>(null);
  const [projecting, setProjecting] = useState(false);
  const [parentLink, setParentLink] = useState<{ membershipId: string; name: string; url: string } | null>(null);
  const [linkBusyId, setLinkBusyId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    void api
      .get<RosterDTO>(`/classes/${classId}/roster`)
      .then(setRoster)
      .catch(() => setLoadError(true));
  }, [classId]);
  useEffect(load, [load]);

  // Parent-link overlay a11y: Escape closes it, and focus returns to the page on close.
  useEffect(() => {
    if (!parentLink) return;
    const trigger = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setParentLink(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      trigger?.focus?.();
    };
  }, [parentLink]);

  const decide = async (membershipId: string, approve: boolean) => {
    setLinkError(null);
    try {
      await api.post(`/memberships/${membershipId}/${approve ? 'approve' : 'decline'}`);
    } catch {
      setLinkError(`Couldn’t ${approve ? 'approve' : 'decline'} that request. Please try again.`);
    }
    load();
  };

  const remove = async (membershipId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from this class? They can rejoin with the code.`)) return;
    setLinkError(null);
    try {
      await api.del(`/memberships/${membershipId}`);
    } catch {
      setLinkError(`Couldn’t remove ${name}. Please try again.`);
    }
    load();
  };

  // Mint a fresh read-only parent link (rotates any prior one) and show the copyable URL.
  const shareParent = async (membershipId: string, name: string) => {
    setLinkBusyId(membershipId);
    setLinkError(null);
    try {
      const { token } = await api.post<ParentLinkDTO>(`/memberships/${membershipId}/parent-link`);
      setParentLink({ membershipId, name, url: `${window.location.origin}/p/${token}` });
    } catch {
      setLinkError('Could not create a parent link. Please try again.');
    } finally {
      setLinkBusyId(null);
    }
  };

  const revokeParent = async () => {
    if (!parentLink) return;
    try {
      await api.del(`/memberships/${parentLink.membershipId}/parent-link`);
    } catch {
      /* best-effort; closing the panel is enough for the teacher */
    }
    setParentLink(null);
  };

  if (!roster)
    return loadError ? (
      <div className="p-9">
        <LoadError what="this roster" onRetry={load} />
      </div>
    ) : (
      <div className="p-9 text-ink-tertiary">Loading…</div>
    );

  return (
    <div className="mx-auto flex max-w-[1190px] flex-col gap-[18px] px-8 pb-9 pt-6">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.01em]">{roster.class.name}</h1>
          <div className="text-[13px] leading-[18px] text-ink-secondary">
            Roster · {roster.members.length} students
            {roster.pending.length > 0 ? ` · ${roster.pending.length} pending` : ''}
          </div>
        </div>
        <div className="ml-auto">
          <ProjectThisButton onClick={() => setProjecting(true)} />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_360px] items-start gap-5 max-[1024px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          {roster.pending.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-line bg-surface-card">
              <div className="flex items-center gap-2 bg-orange-50 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-orange-800">
                <UserPlus size={14} strokeWidth={ICON_STROKE} />
                Waiting for approval
              </div>
              {roster.pending.map((p) => (
                <div key={p.membershipId} className="flex items-center gap-3 border-t border-line px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <b className="block text-[14px] font-semibold leading-[19px]">{p.name}</b>
                    <span className="text-[12px] leading-4 text-ink-tertiary">entered code today</span>
                  </span>
                  <Button size="sm" onClick={() => void decide(p.membershipId, true)}>
                    Approve
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void decide(p.membershipId, false)}>
                    Decline
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <table className="w-full border-collapse overflow-hidden rounded-xl bg-surface-card shadow-[0_0_0_1px_var(--border-default)]">
            <thead>
              <tr>
                {['Member', 'Right now', 'Joined', ''].map((h) => (
                  <th
                    key={h}
                    className="border-b border-line bg-surface-sunken px-4 py-[11px] text-left text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.members.map((m) => (
                <tr key={m.membershipId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-[14px] leading-[19px]">{m.name}</td>
                  <td className="px-4 py-3">
                    {m.current ? (
                      <StatusChip state={m.current.state} size="mini" label={chipLabel(m.current)} />
                    ) : (
                      <span className="text-[13px] text-ink-tertiary">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ink-secondary tnum">
                    {new Date(m.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-4">
                      <button
                        type="button"
                        className="text-[13px] font-semibold text-ink-tertiary hover:text-green-700 disabled:opacity-50"
                        disabled={linkBusyId === m.membershipId}
                        onClick={() => void shareParent(m.membershipId, m.name)}
                      >
                        {linkBusyId === m.membershipId ? 'Creating…' : 'Parent link'}
                      </button>
                      <button
                        type="button"
                        className="text-[13px] font-semibold text-ink-tertiary hover:text-red-600"
                        onClick={() => void remove(m.membershipId, m.name)}
                      >
                        Remove…
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Card className="flex flex-col items-center gap-3.5 text-center">
          <div className="text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary">
            Join code
          </div>
          <JoinCodeBadge code={roster.class.joinCode} size="card" />
          <div className="flex gap-2">
            <CopyButton text={roster.class.joinCode} />
            <ProjectThisButton onClick={() => setProjecting(true)} />
          </div>
          <p className="text-[12.5px] leading-[17px] text-ink-tertiary">
            Students join from the Bali iOS app with this code.
          </p>
        </Card>
      </div>

      {projecting ? (
        <ProjectCodeOverlay
          code={roster.class.joinCode}
          className={roster.class.name}
          onClose={() => setProjecting(false)}
        />
      ) : null}

      {parentLink ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="parent-link-title"
          onClick={() => setParentLink(null)}
        >
          <div
            className="flex w-full max-w-[440px] flex-col gap-4 rounded-lg bg-surface-card p-6 shadow-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <h2 id="parent-link-title" className="text-[17px] font-semibold leading-[22px]">
                Parent link · {parentLink.name}
              </h2>
              <p className="text-[13px] leading-[18px] text-ink-secondary">
                A read-only, status-only view of {parentLink.name.split(' ')[0]}’s focus history — no login. Share it
                with their parent. Creating a new link replaces this one.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] leading-[17px] text-ink-secondary">
                {parentLink.url}
              </span>
              <CopyButton text={parentLink.url} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="text-[13px] font-semibold text-ink-tertiary hover:text-red-600"
                onClick={() => void revokeParent()}
              >
                Revoke link
              </button>
              <div className="flex gap-2">
                <a href={parentLink.url} target="_blank" rel="noopener noreferrer">
                  <Button variant="secondary" size="sm">
                    Open
                  </Button>
                </a>
                <Button size="sm" autoFocus onClick={() => setParentLink(null)}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {linkError ? <ErrorToast message={linkError} onDismiss={() => setLinkError(null)} /> : null}
    </div>
  );
}
