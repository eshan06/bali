'use client';

import { useMemo } from 'react';
import QRCode from 'qrcode';

/**
 * Real QR rendered as a native SVG path — print-ready at any size (vector, 600dpi-safe).
 * Encodes the W2 fallback URL; phones with Bali installed deep-link past it (F7).
 */
export function QrSvg({
  value,
  size = 170,
  className,
  title,
}: {
  value: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const { path, modules } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const data = qr.modules.data;
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (data[y * n + x]) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { path: d, modules: n };
  }, [value]);

  // 2-module quiet zone on every side keeps scanners happy at print size.
  const quiet = 2;
  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${modules + quiet * 2} ${modules + quiet * 2}`}
      width={size}
      height={size}
      role="img"
      aria-label={title ?? 'QR code'}
      className={className}
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={modules + quiet * 2} height={modules + quiet * 2} fill="#FFFFFF" />
      <path d={path} fill="#161310" />
    </svg>
  );
}
