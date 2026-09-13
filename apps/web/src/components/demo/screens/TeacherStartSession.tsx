'use client';

import { AlarmClock, Bell, ListChecks, Users } from 'lucide-react';
import { ICON_STROKE } from '@/components/bali/icons';
import { DEMO } from '../demoData';

/** T9 · Start Session — the pre-session "ready" beat.
 *  Rebuilt from ios/Bali/BaliTeacher/T9StartSession.swift (`form`). Prefills the
 *  next bell and the class's default policy, and shows the expected count. */
export function TeacherStartSession() {
  return (
    <div className="demo-t-screen">
      <div className="demo-t-head">
        <h3 className="demo-t-head-title">Start a session</h3>
        <span className="demo-t-head-sub">{DEMO.className}</span>
      </div>

      <div className="demo-t-form">
        <div className="demo-t-row">
          <Bell size={16} strokeWidth={ICON_STROKE} className="demo-t-row-icon" />
          <span className="demo-t-row-label">Ends at</span>
          <span className="demo-t-row-value">{DEMO.bell}</span>
          <span className="demo-t-row-note">next bell</span>
        </div>

        <div className="demo-t-row">
          <ListChecks size={16} strokeWidth={ICON_STROKE} className="demo-t-row-icon" />
          <span className="demo-t-row-label">Policy</span>
          <span className="demo-t-row-value demo-t-row-value--strong">
            {DEMO.policyName}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        <span className="demo-t-caption">{DEMO.policyName} · Full focus</span>

        <div className="demo-t-row">
          <Users size={16} strokeWidth={ICON_STROKE} className="demo-t-row-icon" />
          <span className="demo-t-row-label">Expecting</span>
          <span className="demo-t-row-value demo-t-row-value--strong">28 students</span>
        </div>

        <div className="demo-t-row demo-t-row--tall">
          <AlarmClock size={16} strokeWidth={ICON_STROKE} className="demo-t-row-icon" />
          <span className="demo-t-row-stack">
            <span className="demo-t-row-label">Remind me at the end</span>
            <span className="demo-t-row-sub">A notification on this phone, nothing else</span>
          </span>
          <span className="demo-t-toggle is-on" aria-hidden="true">
            <i />
          </span>
        </div>

        <button type="button" className="demo-t-primary" tabIndex={-1}>
          Start session
        </button>
      </div>
    </div>
  );
}
