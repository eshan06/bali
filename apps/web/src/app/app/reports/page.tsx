'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/bali/Button';
import { ErrorToast, FilterChip, LoadError } from '@/components/bali/bits';
import { ICON_STROKE } from '@/components/bali/icons';
import { api, API_URL, getToken } from '@/lib/api';
import type { ClassCardDTO } from '@/lib/types';

type Range = 'week' | 'month';

interface UnlockRow {
  unlockId: string;
  at: string;
  whenLabel: string;
  studentId: string;
  studentName: string;
  reason: 'family' | 'medical' | 'safety' | 'other' | 'skipped' | null;
  classId: string;
  className: string;
  weeks: number[];
}

interface UnlocksReport {
  framing: string;
  range: Range;
  count: number;
  rows: UnlockRow[];
}

interface FocusReport {
  periodMinutes: number;
  rows: Array<{
    classId: string;
    className: string;
    avgMinutes: number;
    sessionCount: number;
    scheduledMinutes: number;
  }>;
}

/** 6-week sparkline: 5px bars, warm emergency hue at low weight; zero weeks stone. */
function Sparkline({ weeks, label }: { weeks: number[]; label: string }) {
  return (
    <span className="inline-flex items-end gap-[3px]" role="img" aria-label={label}>
      {weeks.map((count, i) => (
        <i
          key={i}
          className={count === 0 ? 'bg-stone-200' : 'bg-orange-300'}
          style={{ width: 5, height: 3 + Math.min(count * 4.5, 15), borderRadius: 1.5 }}
        />
      ))}
    </span>
  );
}

const reasonCell = (reason: UnlockRow['reason']) => {
  if (reason === 'skipped') return <span className="text-ink-tertiary">skipped</span>;
  if (reason === null) return <span className="text-ink-tertiary">pending</span>;
  return reason.charAt(0).toUpperCase() + reason.slice(1);
};

export default function ReportsPage() {
  const [classes, setClasses] = useState<ClassCardDTO[]>([]);
  const [classId, setClassId] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('month');
  const [unlocks, setUnlocks] = useState<UnlocksReport | null>(null);
  const [focus, setFocus] = useState<FocusReport | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void api.get<{ classes: ClassCardDTO[] }>('/classes').then((r) => setClasses(r.classes)).catch(() => {});
  }, []);

  const query = `?range=${range}${classId ? `&classId=${classId}` : ''}`;
  const loadReports = useCallback(() => {
    setUnlocks(null);
    setFocus(null);
    setLoadError(false);
    void api.get<UnlocksReport>(`/reports/unlocks${query}`).then(setUnlocks).catch(() => setLoadError(true));
    void api.get<FocusReport>(`/reports/focus-minutes${query}`).then(setFocus).catch(() => setLoadError(true));
  }, [query]);
  useEffect(loadReports, [loadReports]);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    setActionError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/reports/unlocks${query}&format=csv`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`export ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bali-unlocks-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setActionError('Couldn’t export the CSV. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [query]);

  const rangeLabel = range === 'month' ? 'this month' : 'this week';
  const maxMinutes = focus ? Math.max(focus.periodMinutes, ...focus.rows.map((r) => r.avgMinutes)) : 50;

  return (
    <div className="mx-auto flex max-w-[1190px] flex-col gap-[18px] px-8 pb-9 pt-6">
      <div className="flex items-start gap-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.01em]">Reports</h1>
          {/* The framing line is part of the page header — designed copy, not a tooltip. */}
          <div className="mt-1 text-[16px] italic leading-6 text-ink-secondary">
            Patterns are conversation starters, not verdicts.
          </div>
        </div>
        <div className="ml-auto">
          <Button variant="secondary" loading={exporting} disabled={exporting} onClick={() => void exportCsv()}>
            <Download size={16} strokeWidth={ICON_STROKE} />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={classId === null} onClick={() => setClassId(null)}>
          All classes
        </FilterChip>
        {classes.map((c) => (
          <FilterChip key={c.id} active={classId === c.id} onClick={() => setClassId(c.id)}>
            {c.name}
          </FilterChip>
        ))}
        <span className="flex-1" />
        <FilterChip active={range === 'week'} onClick={() => setRange('week')}>
          This week
        </FilterChip>
        <FilterChip active={range === 'month'} onClick={() => setRange('month')}>
          This month
        </FilterChip>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] items-start gap-5 max-[1024px]:grid-cols-1">
        <div>
          <div className="mb-2.5 text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary">
            Emergency unlocks{unlocks ? ` · ${unlocks.count} ${rangeLabel}` : ''}
          </div>
          {unlocks === null ? (
            loadError ? (
              <LoadError what="reports" onRetry={loadReports} />
            ) : (
              <div className="text-ink-tertiary">Loading…</div>
            )
          ) : unlocks.rows.length === 0 ? (
            <div className="rounded-md border border-line bg-surface-card p-6 text-[14px] leading-5 text-ink-secondary">
              No emergency unlocks {rangeLabel} — nothing here is a problem to solve.
            </div>
          ) : (
            <table className="w-full border-collapse overflow-hidden rounded-xl bg-surface-card shadow-[0_0_0_1px_var(--border-default)]">
              <thead>
                <tr>
                  {['When', 'Student', 'Reason', 'Session', 'Last 6 wks'].map((h) => (
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
                {unlocks.rows.map((r) => (
                  <tr key={r.unlockId} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-[13px] text-ink-secondary tnum">{r.whenLabel}</td>
                    <td className="px-4 py-3 text-[14px] font-semibold leading-[19px]">{r.studentName}</td>
                    <td className="px-4 py-3 text-[14px] leading-[19px]">{reasonCell(r.reason)}</td>
                    <td className="px-4 py-3 text-[12.5px] leading-[17px] text-ink-secondary">{r.className}</td>
                    <td className="px-4 py-3">
                      <Sparkline
                        weeks={r.weeks}
                        label={`${r.studentName}: unlocks per week over the last 6 weeks`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-2.5 text-[12.5px] leading-[18px] text-ink-tertiary">
            A repeating sparkline is a nudge to check in privately — the export carries the same
            framing line in its header row.
          </div>
        </div>

        <div>
          <div className="mb-2.5 text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary">
            Focus minutes per session
          </div>
          <div className="rounded-md border border-line bg-surface-card p-5">
            {focus === null ? (
              loadError ? (
                <div className="text-[13.5px] leading-[19px] text-ink-secondary">
                  Couldn’t load.{' '}
                  <button type="button" onClick={loadReports} className="font-semibold text-ink-brand hover:underline">
                    Retry
                  </button>
                </div>
              ) : (
                <div className="text-ink-tertiary">Loading…</div>
              )
            ) : focus.rows.length === 0 ? (
              <div className="text-[14px] leading-5 text-ink-secondary">
                No ended sessions {rangeLabel} yet — averages appear after the first bell.
              </div>
            ) : (
              <div className="flex flex-col gap-[11px]">
                {focus.rows.map((r) => (
                  <div key={r.classId} className="flex items-center gap-3">
                    <span className="w-[150px] flex-none text-[12.5px] leading-[17px] text-ink-secondary">
                      {r.className}
                    </span>
                    <div className="h-3.5 flex-1 overflow-hidden rounded bg-surface-sunken">
                      <div
                        className="h-full rounded bg-green-700"
                        style={{ width: `${Math.min(100, (r.avgMinutes / maxMinutes) * 100)}%` }}
                      />
                    </div>
                    <span className="w-[70px] flex-none text-right text-[12.5px] font-medium leading-[17px] text-ink-secondary tnum">
                      {r.avgMinutes} min avg
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 text-[12.5px] leading-[18px] text-ink-tertiary">
              Out of a {focus?.periodMinutes ?? 50}-minute period. No per-student minute rankings
              exist anywhere — averages only.
            </div>
          </div>
        </div>
      </div>

      {actionError ? <ErrorToast message={actionError} onDismiss={() => setActionError(null)} /> : null}
    </div>
  );
}
