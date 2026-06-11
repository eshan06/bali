export const hhmm = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export const clock24 = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });

export const countdownText = (totalSeconds: number): string =>
  `${Math.floor(Math.max(0, totalSeconds) / 60)}:${String(Math.max(0, totalSeconds) % 60).padStart(2, '0')}`;
