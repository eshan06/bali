'use client';

import { DEMO } from '../demoData';
import { FocusScopeRow } from './iosBits';

/** S4 · Tap-In Confirmation, `ready` variant.
 *  Copy and layout from ios/Bali/Bali/Features/TapInView.swift (`ready`). */
export function StudentTapIn() {
  return (
    <div className="demo-s-screen demo-s-tapin">
      <div className="demo-s-spacer" />
      <div className="demo-s-tapin-head">
        <span className="demo-s-tapin-kicker">You tapped into</span>
        <h3 className="demo-s-tapin-class">{DEMO.className}</h3>
        <span className="demo-s-tapin-until">until {DEMO.bell}</span>
      </div>
      <div className="demo-s-pad demo-s-scope">
        <FocusScopeRow />
      </div>
      <div className="demo-s-spacer" />
      <div className="demo-s-pad demo-s-tapin-foot">
        <button type="button" className="demo-s-primary" tabIndex={-1}>
          Start Focus
        </button>
        <span className="demo-s-hint">Ends at the bell — or instantly with Emergency Unlock.</span>
      </div>
    </div>
  );
}
