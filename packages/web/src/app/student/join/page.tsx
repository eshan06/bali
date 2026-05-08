'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const Scanner = dynamic(
  () => import('@yudiel/react-qr-scanner').then((m) => m.Scanner),
  { ssr: false }
);

const BRAND = '#2E5BD0';

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
    <div className="space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <p
          className="text-[11px] font-black uppercase tracking-[0.22em]"
          style={{ color: BRAND }}
        >
          Join
        </p>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 leading-[1.05]">
          Join a class
        </h1>
        <p className="text-sm md:text-base text-gray-500 max-w-xl">
          Use any of the three options below to join your teacher's class.
        </p>
      </header>

      {/* Paste invite link */}
      <JoinSection
        title="Paste invite link"
        description="Use the link your teacher shared with you."
        icon={<IconLink />}
      >
        <form onSubmit={handleLinkSubmit} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="https://.../join/..."
            className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            Join
          </button>
        </form>
        {linkError && <p className="text-sm text-red-600">{linkError}</p>}
      </JoinSection>

      {/* Enter class code */}
      <JoinSection
        title="Enter class code"
        description="The code is the unique class identifier — your teacher can copy it from the class page."
        icon={<IconCode />}
      >
        <form onSubmit={handleCodeSubmit} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="1a2b3c4d-...."
            className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            Join
          </button>
        </form>
        {codeError && <p className="text-sm text-red-600">{codeError}</p>}
      </JoinSection>

      {/* Scan QR code */}
      <JoinSection
        title="Scan QR code"
        description="Point your camera at the QR code your teacher is showing."
        icon={<IconQr />}
      >
        {!scannerOpen ? (
          <button
            onClick={() => {
              setScanError('');
              setScannerOpen(true);
            }}
            className="inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            Open camera
          </button>
        ) : (
          <div className="space-y-3">
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
              className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        {scanError && <p className="text-sm text-red-600">{scanError}</p>}
      </JoinSection>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function JoinSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-card rounded-2xl p-6">
      <div className="flex items-start gap-4">
        <div
          className="shrink-0 h-11 w-11 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(46, 91, 208, 0.10)', color: BRAND }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0 space-y-4">
          <div>
            <h3 className="text-base md:text-lg font-black tracking-tight text-gray-900">
              {title}
            </h3>
            <p className="mt-0.5 text-sm text-gray-500">{description}</p>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

function IconLink() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-5 w-5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
      />
    </svg>
  );
}

function IconCode() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-5 w-5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
      />
    </svg>
  );
}

function IconQr() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-5 w-5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 4h2m4 0h-2m-4-4h2m2 4v2"
      />
    </svg>
  );
}
