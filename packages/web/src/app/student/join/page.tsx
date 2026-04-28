'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const Scanner = dynamic(
  () => import('@yudiel/react-qr-scanner').then((m) => m.Scanner),
  { ssr: false }
);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const JOIN_PATH_RE = /\/join\/([0-9a-f-]{36})/i;

function extractClassId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(JOIN_PATH_RE);
  if (m) return m[1];
  const u = trimmed.match(UUID_RE);
  if (u) return u[0];
  return null;
}

export default function StudentJoinPage() {
  const router = useRouter();

  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState('');

  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState('');

  const goToClass = (classId: string) => {
    router.push(`/join/${classId}/`);
  };

  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError('');
    const id = extractClassId(linkInput);
    if (!id) {
      setLinkError("That doesn't look like a Bali invite link.");
      return;
    }
    goToClass(id);
  };

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError('');
    const id = extractClassId(codeInput);
    if (!id) {
      setCodeError('Class codes look like a UUID, e.g. 1a2b3c4d-...');
      return;
    }
    goToClass(id);
  };

  const handleScan = (results: { rawValue: string }[]) => {
    if (!results || results.length === 0) return;
    const value = results[0].rawValue;
    const id = extractClassId(value);
    if (!id) {
      setScanError('That QR code is not a Bali invite.');
      return;
    }
    setScannerOpen(false);
    goToClass(id);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Join a class</h1>
        <p className="text-gray-500 mt-1">
          Use any of the three options below to join your teacher&apos;s class.
        </p>
      </div>

      {/* Paste invite link */}
      <section className="glass-card rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <IconBadge>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </IconBadge>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">Paste invite link</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Use the link your teacher shared with you.
            </p>
            <form onSubmit={handleLinkSubmit} className="mt-4 flex gap-2">
              <input
                type="text"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://.../join/..."
                className="flex-1 rounded-xl bg-white/80 border border-white/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="submit"
                className="rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 transition-colors"
              >
                Join
              </button>
            </form>
            {linkError && <p className="mt-2 text-sm text-red-600">{linkError}</p>}
          </div>
        </div>
      </section>

      {/* Enter class code */}
      <section className="glass-card rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <IconBadge>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </IconBadge>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">Enter class code</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              The code is the unique class identifier — your teacher can copy it from the class page.
            </p>
            <form onSubmit={handleCodeSubmit} className="mt-4 flex gap-2">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="1a2b3c4d-...."
                className="flex-1 rounded-xl bg-white/80 border border-white/70 px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="submit"
                className="rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 transition-colors"
              >
                Join
              </button>
            </form>
            {codeError && <p className="mt-2 text-sm text-red-600">{codeError}</p>}
          </div>
        </div>
      </section>

      {/* Scan QR code */}
      <section className="glass-card rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <IconBadge>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 4h2m4 0h-2m-4-4h2m2 4v2" />
            </svg>
          </IconBadge>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">Scan QR code</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Point your camera at the QR code your teacher is showing.
            </p>

            {!scannerOpen ? (
              <button
                onClick={() => {
                  setScanError('');
                  setScannerOpen(true);
                }}
                className="mt-4 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 transition-colors"
              >
                Open camera
              </button>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl overflow-hidden bg-black/80 max-w-sm aspect-square">
                  <Scanner
                    onScan={handleScan}
                    onError={(err) => {
                      setScanError(
                        (err as any)?.message ||
                          'Could not access the camera. Check permissions and try again.'
                      );
                    }}
                    constraints={{ facingMode: 'environment' }}
                    styles={{ container: { width: '100%', height: '100%' } }}
                  />
                </div>
                <button
                  onClick={() => {
                    setScannerOpen(false);
                    setScanError('');
                  }}
                  className="rounded-xl border border-white/70 bg-white/60 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white/90 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
            {scanError && <p className="mt-2 text-sm text-red-600">{scanError}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function IconBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 h-10 w-10 rounded-full bg-primary-100/70 backdrop-blur flex items-center justify-center text-primary-600">
      {children}
    </div>
  );
}
