'use client';

import { DEMO } from '../demoData';

/** S10 · the iOS Screen Time shield, as configured in
 *  ios/Bali/BaliShield/ShieldConfigurationExtension.swift — strictly Apple's six
 *  primitives: blur, tint, icon, title, subtitle, primary button, secondary label.
 *  The subtitle always names the emergency path; the shield never traps. */
export function ShieldOverlay() {
  return (
    <div className="demo-shield">
      {/* the app underneath, blurred — never a real product's UI */}
      <div className="demo-shield-under" aria-hidden="true">
        <div className="demo-shield-under-bar" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="demo-shield-under-row" key={i}>
            <span className="demo-shield-under-av" />
            <span className="demo-shield-under-lines">
              <i style={{ width: `${58 + ((i * 13) % 34)}%` }} />
              <i style={{ width: `${34 + ((i * 21) % 40)}%` }} />
            </span>
          </div>
        ))}
      </div>

      <div className="demo-shield-tint" aria-hidden="true" />

      <div className="demo-shield-card">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <circle cx="32" cy="32" r="27.2" stroke="#2E2B27" strokeWidth="9.6" />
          <path
            d="M 32 4.8 A 27.2 27.2 0 1 1 8.6 45.9"
            stroke="#62A483"
            strokeWidth="9.6"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
        <h3 className="demo-shield-title">Focused with {DEMO.teacher}</h3>
        <p className="demo-shield-sub">Until {DEMO.bell} · Emergency? Open Bali</p>
        <span className="demo-shield-primary">OK</span>
        <span className="demo-shield-secondary">Open Bali</span>
      </div>
    </div>
  );
}
