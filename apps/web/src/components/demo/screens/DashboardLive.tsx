'use client';

import { Maximize2 } from 'lucide-react';
import { Arc } from '@/components/bali/Arc';
import { StatusChip, SummaryStrip } from '@/components/bali/StatusChip';
import { ToastCard } from '@/components/bali/Toaster';
import { ICON_STROKE } from '@/components/bali/icons';
import { DEMO, countsFor, mmss, type DemoStudent } from '../demoData';

/** W6 · the live grid — the flagship dashboard screen, laid out exactly as
 *  apps/web/src/app/app/classes/[id]/live/page.tsx renders it, and built from the
 *  same production components (Arc, StatusChip, SummaryStrip, ToastCard) so it
 *  cannot drift from the real thing. */
export function DashboardLive({
  roster,
  seconds,
  toast = false,
}: {
  roster: DemoStudent[];
  seconds: number;
  /** Show the emergency toast the teacher actually receives. */
  toast?: boolean;
}) {
  const counts = countsFor(roster);
  const pct = Math.min(1, Math.max(0, seconds / DEMO.sessionTotalSeconds));

  return (
    <div className="demo-dash">
      <div className="demo-dash-inner">
        <div className="demo-dash-head">
          <Arc size={44} stroke={5} pct={pct} />
          <div>
            <h3 className="demo-dash-title">{DEMO.className}</h3>
            <div className="demo-dash-sub">{DEMO.policyName} · Full focus</div>
          </div>
          <div className="demo-dash-clock">
            <div className="demo-dash-count tnum">{mmss(seconds)}</div>
            <div className="demo-dash-ends">ends {DEMO.bellShort}</div>
          </div>
          <div className="demo-dash-actions">
            <span className="demo-dash-btn">Extend</span>
            <span className="demo-dash-btn demo-dash-btn--destructive">End session…</span>
            <span className="demo-dash-btn demo-dash-btn--icon" aria-hidden="true">
              <Maximize2 size={16} strokeWidth={ICON_STROKE} />
            </span>
          </div>
        </div>

        <SummaryStrip counts={counts} />

        <div className="demo-dash-grid" role="list" aria-label={`Live status, ${roster.length} students`}>
          {roster.map((s) => (
            <span role="listitem" key={s.name} className="demo-dash-cell">
              <StatusChip
                state={s.state}
                name={s.name}
                size="grid"
                pulse={s.state === 'emergency_unlocked'}
              />
            </span>
          ))}
        </div>
      </div>

      {toast ? (
        <div className="demo-dash-toast">
          <ToastCard
            toast={{
              id: 'demo-emergency',
              variant: 'emergency',
              title: 'Jordan P. used Emergency Unlock',
              sub: 'Reason pending · 10:31',
              action: { label: 'Open student', onClick: () => {} },
            }}
            onDismiss={() => {}}
          />
        </div>
      ) : null}
    </div>
  );
}
