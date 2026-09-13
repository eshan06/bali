'use client';

import { ChevronRight, Settings2 } from 'lucide-react';
import { ICON_STROKE } from '@/components/bali/icons';
import { DEMO } from '../demoData';

/** T1 · Teacher Home, at 9:54 — before the bell, so there is no live card.
 *  Rebuilt from ios/Bali/BaliTeacher/T1Home.swift. The greeting template is
 *  "Good {part}, {name}"; the meta line is "{dateLabel} · {class} starts {time}"
 *  when a future period exists. Event lines are the server's own renderer
 *  (apps/api/src/serialize.ts). */
export function TeacherHome() {
  return (
    <div className="demo-t-screen demo-t-home">
      <div className="demo-t-home-greet">
        <div>
          <h3 className="demo-t-home-hello">Good morning, {DEMO.teacher}</h3>
          <span className="demo-t-home-meta">
            {DEMO.date} · Period 3 starts {DEMO.sessionStart}
          </span>
        </div>
        <Settings2 size={20} strokeWidth={ICON_STROKE} className="demo-t-home-gear" aria-hidden="true" />
      </div>

      <button type="button" className="demo-t-approvals" tabIndex={-1}>
        <span className="demo-t-approvals-count">3</span>
        <span className="demo-t-approvals-text">students want to join</span>
        <ChevronRight size={16} strokeWidth={ICON_STROKE} className="demo-t-chev" />
      </button>

      <span className="demo-t-seclabel">TODAY</span>
      <div className="demo-t-today">
        <div className="demo-t-today-row is-done">
          <span className="demo-t-today-time">08:05</span>
          <span className="demo-t-today-name">Period 1 — Algebra I</span>
          <span className="demo-t-ended">Ended</span>
        </div>
        <div className="demo-t-today-row">
          <span className="demo-t-today-time">09:55</span>
          <span className="demo-t-today-name">{DEMO.className}</span>
          <span className="demo-t-start">Start</span>
        </div>
      </div>

      <span className="demo-t-seclabel">RECENT ACTIVITY</span>
      <div className="demo-t-feed">
        {(
          [
            ['Session ended at the bell', 'Period 1 — Algebra I', '8:50', 'green'],
            ['Pass granted to Devin S. · 10 min', '"nurse" · Period 1 — Algebra I', '8:31', 'blue'],
            ['Priya N. asked to join', DEMO.className, 'yesterday', 'green'],
          ] as Array<[string, string, string, string]>
        ).map(([title, sub, at, tone], i, arr) => (
          <div className="demo-t-feed-row" key={title}>
            <span className="demo-t-feed-rail">
              <i className={`demo-t-dot is-${tone}`} />
              {i < arr.length - 1 ? <b /> : null}
            </span>
            <span className="demo-t-feed-copy">
              <span className="demo-t-feed-title">{title}</span>
              <span className="demo-t-feed-sub">{sub}</span>
            </span>
            <span className="demo-t-feed-at">{at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
