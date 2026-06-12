'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/bali/Button';
import { JoinCodeBadge, CopyButton, Card } from '@/components/bali/bits';
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

  const load = useCallback(() => {
    void api.get<RosterDTO>(`/classes/${classId}/roster`).then(setRoster);
  }, [classId]);
  useEffect(load, [load]);

  const decide = async (membershipId: string, approve: boolean) => {
    await api.post(`/memberships/${membershipId}/${approve ? 'approve' : 'decline'}`);
    load();
  };

  const remove = async (membershipId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from this class? They can rejoin with the code.`)) return;
    await api.del(`/memberships/${membershipId}`);
    load();
  };

  if (!roster) return <div className="p-9 text-ink-tertiary">Loading…</div>;

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
                    <button
                      type="button"
                      className="text-[13px] font-semibold text-ink-tertiary hover:text-red-600"
                      onClick={() => void remove(m.membershipId, m.name)}
                    >
                      Remove…
                    </button>
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
    </div>
  );
}
