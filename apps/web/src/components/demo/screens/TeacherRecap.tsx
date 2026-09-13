'use client';

import { LockOpen, MessageSquare } from 'lucide-react';
import { ICON_STROKE } from '@/components/bali/icons';
import { DEMO } from '../demoData';

/** T10 · Session Recap — the closing beat, from ios/Bali/BaliTeacher/T10Recap.swift.
 *  Neutral counts, emergencies listed plainly with a quiet check-in nudge, the
 *  framing line — and zero red, no ranking, no scoreboard. */
export function TeacherRecap({ variant = 'incident' }: { variant?: 'clean' | 'incident' }) {
  return (
    <div className="demo-t-screen demo-t-recap">
      {variant === 'clean' ? <CleanHeader /> : <StatsBlock />}
      {variant === 'incident' ? <EmergenciesBlock /> : null}
      <p className="demo-t-framing">Patterns are conversation starters, not verdicts.</p>
      <div className="demo-t-actions">
        <button type="button" className="demo-t-primary" tabIndex={-1}>
          Done
        </button>
        <button type="button" className="demo-t-secondary" tabIndex={-1}>
          View full log
        </button>
      </div>
    </div>
  );
}

function CleanHeader() {
  return (
    <div className="demo-t-clean">
      <span className="demo-t-clean-mark" aria-hidden="true">
        <svg width="104" height="104" viewBox="0 0 104 104" fill="none">
          <circle cx="52" cy="52" r="48" stroke="#2C6F51" strokeWidth="8" />
          <path d="M34 53l13 13 24-27" stroke="#2C6F51" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h3 className="demo-t-clean-title">Smooth period.</h3>
      <span className="demo-t-clean-class">{DEMO.className}</span>
      <p className="demo-t-clean-body">Everyone who tapped in stayed focused to the bell</p>
      <span className="demo-t-clean-sub">26 students · 47 min median focus</span>
    </div>
  );
}

function StatsBlock() {
  const cells: Array<[string, string]> = [
    ['24', 'stayed focused'],
    ['1', 'emergency unlock'],
    ['1', 'pass'],
    ['0', 'permission off'],
  ];
  return (
    <div className="demo-t-stats">
      <div className="demo-t-stats-head">
        <h3 className="demo-t-stats-title">Session recap</h3>
        <span className="demo-t-stats-sub">{DEMO.className} · 9:55–10:45 AM · 50 min</span>
      </div>
      <div className="demo-t-statgrid">
        {cells.map(([value, label]) => (
          <div className="demo-t-statcard" key={label}>
            <span className="demo-t-statcard-value">{value}</span>
            <span className="demo-t-statcard-label">{label}</span>
          </div>
        ))}
      </div>
      <span className="demo-t-stats-foot">47 min median focus · 2 never joined</span>
    </div>
  );
}

function EmergenciesBlock() {
  return (
    <div className="demo-t-emg">
      <span className="demo-t-seclabel">EMERGENCIES</span>
      <div className="demo-t-emg-card">
        <div className="demo-t-emg-top">
          <LockOpen size={17} strokeWidth={ICON_STROKE} className="demo-t-emg-icon" />
          <span className="demo-t-emg-lines">
            <span className="demo-t-emg-name">Jordan P. · 10:31 AM</span>
            <span className="demo-t-emg-reason">Family · re-focused 4 min later</span>
          </span>
        </div>
        <div className="demo-t-emg-nudge">
          <MessageSquare size={14} strokeWidth={ICON_STROKE} />
          <span>A quiet check-in with Jordan later might be welcome.</span>
        </div>
      </div>
    </div>
  );
}
