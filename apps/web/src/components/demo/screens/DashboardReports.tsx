'use client';

import { Download } from 'lucide-react';
import { FilterChip } from '@/components/bali/bits';
import { ICON_STROKE } from '@/components/bali/icons';
import { DEMO } from '../demoData';

/** Reports — the only surface on the page at a scale longer than one period.
 *  Copy verbatim from apps/web/src/app/app/reports/page.tsx: the framing line
 *  is part of the page header (designed copy, not a tooltip), and the captions
 *  are the load-bearing anti-ranking claims. */

/** Six weekly bars, newest last. A repeating sparkline is the nudge. */
function Sparkline({ weeks, label }: { weeks: number[]; label: string }) {
  const max = Math.max(1, ...weeks);
  return (
    <span className="demo-rep-spark" role="img" aria-label={label}>
      {weeks.map((n, i) => (
        <i key={i} style={{ height: `${Math.max(2, (n / max) * 18)}px`, opacity: n === 0 ? 0.28 : 1 }} />
      ))}
    </span>
  );
}

export function DashboardReports() {
  const unlocks: Array<[string, string, string, string, number[]]> = [
    ['Sep 13 · 10:31', DEMO.student.short, 'Family', DEMO.className, [0, 0, 1, 0, 0, 1]],
    ['Sep 9 · 13:12', 'Devin S.', 'Medical', 'Period 4 — Precalculus', [0, 1, 0, 0, 0, 0]],
    ['Sep 4 · 09:20', 'Noor H.', 'skipped', 'Period 1 — Algebra I', [0, 0, 0, 0, 1, 0]],
  ];
  const focus: Array<[string, number]> = [
    ['Period 1 — Algebra I', 46],
    [DEMO.className, 47],
    ['Period 4 — Precalculus', 44],
  ];

  return (
    <div className="demo-rep">
      <div className="demo-rep-inner">
        <div className="demo-rep-head">
          <div>
            <h3 className="demo-rep-title">Reports</h3>
            <p className="demo-rep-framing">Patterns are conversation starters, not verdicts.</p>
          </div>
          <span className="demo-rep-export">
            <Download size={16} strokeWidth={ICON_STROKE} />
            Export CSV
          </span>
        </div>

        <div className="demo-rep-filters">
          <FilterChip active onClick={() => {}}>
            All classes
          </FilterChip>
          <FilterChip active={false} onClick={() => {}}>
            Period 1 — Algebra I
          </FilterChip>
          <FilterChip active={false} onClick={() => {}}>
            {DEMO.className}
          </FilterChip>
          <span className="demo-rep-spacer" />
          <FilterChip active={false} onClick={() => {}}>
            This week
          </FilterChip>
          <FilterChip active onClick={() => {}}>
            This month
          </FilterChip>
        </div>

        <div className="demo-rep-cols">
          <div>
            <div className="demo-rep-eyebrow">Emergency unlocks · 3 this month</div>
            <table className="demo-rep-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Student</th>
                  <th>Reason</th>
                  <th>Session</th>
                  <th>Last 6 wks</th>
                </tr>
              </thead>
              <tbody>
                {unlocks.map(([when, who, reason, cls, weeks]) => (
                  <tr key={when}>
                    <td className="demo-rep-when tnum">{when}</td>
                    <td className="demo-rep-who">{who}</td>
                    <td className={reason === 'skipped' ? 'demo-rep-muted' : undefined}>{reason}</td>
                    <td className="demo-rep-muted">{cls}</td>
                    <td>
                      <Sparkline weeks={weeks} label={`${who}: unlocks per week over the last 6 weeks`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="demo-rep-caption">
              A repeating sparkline is a nudge to check in privately — the export carries the same
              framing line in its header row.
            </p>
          </div>

          <div>
            <div className="demo-rep-eyebrow">Focus minutes per session</div>
            <div className="demo-rep-focus">
              {focus.map(([cls, mins]) => (
                <div className="demo-rep-focus-row" key={cls}>
                  <span>{cls}</span>
                  <span className="demo-rep-avg tnum">{mins} min avg</span>
                </div>
              ))}
            </div>
            <p className="demo-rep-caption">
              Out of a 50-minute period. No per-student minute rankings exist anywhere — averages
              only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
