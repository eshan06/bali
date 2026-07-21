import { ImageResponse } from 'next/og';

export const alt = 'Bali — focus sessions for your classroom';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Branded link-preview card (Slack/iMessage/email). Rendered at build/request. */
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '90px',
          background: '#F7F5F2',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <svg width="92" height="92" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="7.5" stroke="#BCDCCA" strokeWidth="3" />
            <path d="M 10 2.5 A 7.5 7.5 0 1 1 3.5 13.75" stroke="#2C6F51" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 64, fontWeight: 700, color: '#211F1B' }}>Bali</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 60, fontWeight: 700, color: '#211F1B', lineHeight: 1.1 }}>
          Fifty focused minutes. One tap.
        </div>
        <div style={{ marginTop: 24, fontSize: 30, color: '#5B564E', maxWidth: 900 }}>
          Students tap a desk tag and their distractions rest until the bell. Teachers see one calm
          grid. The emergency exit is always one hold away.
        </div>
      </div>
    ),
    { ...size },
  );
}
