import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Apple touch icon — the brand mark on a warm tile. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F7F5F2',
        }}
      >
        <svg width="120" height="120" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7.5" stroke="#BCDCCA" strokeWidth="3" />
          <path d="M 10 2.5 A 7.5 7.5 0 1 1 3.5 13.75" stroke="#2C6F51" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
