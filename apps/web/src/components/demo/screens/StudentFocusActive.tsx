'use client';

import clsx from 'clsx';
import { DEMO, mmss } from '../demoData';
import { EmergencyUnlock, FocusScopeRow, IOSArc } from './iosBits';

/** S6 · Focus Active — the flagship student screen, rebuilt from
 *  ios/Bali/Bali/Features/FocusActiveView.swift. Header, hero arc, the scope row,
 *  and the always-available EmergencyUnlockControl. The hold is real: one second
 *  fills the control and unlocks, exactly as the app does. */
export function StudentFocusActive({
  seconds,
  unlocked,
  onUnlock,
  showReason,
  onPickReason,
}: {
  seconds: number;
  unlocked: boolean;
  onUnlock: () => void;
  showReason?: boolean;
  onPickReason?: () => void;
}) {
  const final2 = !unlocked && seconds <= 120;
  const pct = Math.min(1, Math.max(0, seconds / DEMO.sessionTotalSeconds));

  return (
    <div className="demo-s-screen">
      <div className="demo-s-head">
        <h3 className="demo-s-head-class">{DEMO.className}</h3>
        <span className="demo-s-head-sub">
          with {DEMO.teacher} · ends {DEMO.bell}
        </span>
      </div>

      <div className="demo-s-spacer" />

      <div className="demo-s-arcwrap">
        <IOSArc pct={pct} final2={final2}>
          <span className={clsx('demo-s-time', final2 && 'is-final2')}>{mmss(seconds)}</span>
          <span className="demo-s-until">until {DEMO.bell}</span>
        </IOSArc>
      </div>

      <div className="demo-s-pad demo-s-scope">
        <FocusScopeRow />
      </div>

      <div className="demo-s-spacer" />

      <div className="demo-s-pad demo-s-bottom">
        <EmergencyUnlock teacher={DEMO.teacher} unlocked={unlocked} onUnlock={onUnlock} />
        <span className="demo-s-hint">
          {unlocked
            ? 'Re-focus any time by tapping the desk tag.'
            : 'Works without Wi-Fi. Releasing early does nothing.'}
        </span>
        {unlocked ? <span className="demo-s-back">Back to Today</span> : null}
      </div>

      {showReason ? <ReasonSheet onPick={onPickReason} /> : null}
    </div>
  );
}

/** S7 · Post-emergency sheet. Five chips, identical size — Skip is styled exactly
 *  like the rest, and that is the point. FocusActiveView.swift, `ReasonSheet`. */
function ReasonSheet({ onPick }: { onPick?: () => void }) {
  const reasons = ['Family', 'Medical', 'Safety', 'Other', 'Skip'];
  return (
    <div className="demo-s-sheet">
      <span className="demo-s-grabber" aria-hidden="true" />
      <h4 className="demo-s-sheet-title">You&rsquo;re unlocked. Everything OK?</h4>
      <p className="demo-s-sheet-sub">Sharing a reason is optional — it goes only to {DEMO.teacher}.</p>
      <div className="demo-s-chips">
        {reasons.map((r) => (
          <button key={r} type="button" className="demo-s-chip" onClick={onPick}>
            {r}
          </button>
        ))}
      </div>
      <span className="demo-s-sheet-foot">{DEMO.teacher} was notified.</span>
    </div>
  );
}
