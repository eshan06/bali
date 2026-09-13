'use client';

import clsx from 'clsx';
import { LockOpen } from 'lucide-react';
import { ICON_STROKE } from '@/components/bali/icons';
import { DEMO } from '../demoData';

/** T3 · Student detail — what the dashboard's "Open student" actually opens.
 *  Rebuilt from ios/Bali/BaliTeacher/T3Student.swift. Timeline lines are the
 *  server's renderer verbatim (apps/api/src/serialize.ts); the pass card's
 *  "5 / 10 / 15 / Custom" row and the "Grant {n}-minute pass" label are the
 *  real controls. There is no drag indicator anywhere in the teacher app. */
export function TeacherStudentSheet() {
  /* The endpoint filters to this session AND this student, so class-level rows
     (e.g. "Session started") never appear here. Three rows also keeps the sheet
     inside one screen, so the no-device card and the boundary line stay visible. */
  const events: Array<[string, string | null, string, string]> = [
    [`${DEMO.student.full} tapped in`, DEMO.className, '9:56', 'green'],
    [`${DEMO.student.full} — Emergency Unlock`, `reason pending · ${DEMO.className}`, '10:31', 'orange'],
    [`${DEMO.student.full} re-focused`, DEMO.className, '10:35', 'green'],
  ];

  return (
    <div className="demo-t-screen demo-t-sheet">
      <div className="demo-t-sheet-head">
        <span className="demo-t-sheet-names">
          <span className="demo-t-sheet-name">{DEMO.student.full}</span>
          <span className="demo-t-sheet-sub">tapped in 9:56 AM · iPhone</span>
        </span>
        <span className="demo-t-chip is-focused">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12 2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Focused
        </span>
      </div>

      <div className="demo-t-seg" role="tablist" aria-label="Student detail">
        <span className="demo-t-seg-item is-on">This session</span>
        <span className="demo-t-seg-item">Recent</span>
      </div>

      <span className="demo-t-seclabel">THIS SESSION</span>
      <div className="demo-t-card demo-t-timeline">
        {events.map(([title, sub, at, tone], i) => (
          <div className="demo-t-feed-row" key={title + at}>
            <span className="demo-t-feed-rail">
              <i className={`demo-t-dot is-${tone}`} />
              {i < events.length - 1 ? <b /> : null}
            </span>
            <span className="demo-t-feed-copy">
              <span className="demo-t-feed-title">{title}</span>
              {sub ? <span className="demo-t-feed-sub">{sub}</span> : null}
            </span>
            <span className="demo-t-feed-at">{at}</span>
          </div>
        ))}
      </div>

      <span className="demo-t-seclabel">GRANT A PASS</span>
      <div className="demo-t-card demo-t-pass">
        <div className="demo-t-durations">
          {['5', '10', '15'].map((m) => (
            <span key={m} className={clsx('demo-t-dur', m === '10' && 'is-on')}>
              {m}
            </span>
          ))}
          <span className="demo-t-dur demo-t-dur--custom">Custom</span>
        </div>
        <span className="demo-t-field">Reason (optional) — e.g. nurse</span>
        <button type="button" className="demo-t-pass-btn" tabIndex={-1}>
          Grant 10-minute pass
        </button>
        <span className="demo-t-pass-foot">Shields return automatically when it ends.</span>
      </div>

      <div className="demo-t-card demo-t-nodevice">
        <span className="demo-t-nodevice-copy">
          <span className="demo-t-nodevice-title">No device today</span>
          <span className="demo-t-nodevice-sub">
            Marks {DEMO.student.first} out of today&rsquo;s grid only
          </span>
        </span>
        <span className="demo-t-toggle" aria-hidden="true">
          <i />
        </span>
      </div>

      <p className="demo-t-boundary">
        <LockOpen size={13} strokeWidth={ICON_STROKE} />
        Session status only — Bali never sees {DEMO.student.first}&rsquo;s screen, apps, messages, or
        location.
      </p>
    </div>
  );
}
