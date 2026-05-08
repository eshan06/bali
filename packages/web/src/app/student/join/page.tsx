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

type Tab = 'link' | 'code' | 'qr';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'link', label: 'Link', icon: <IconLink /> },
  { id: 'code', label: 'Code', icon: <IconCode /> },
  { id: 'qr', label: 'QR', icon: <IconQr /> },
];

export default function StudentJoinPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('link');
  const [joining, setJoining] = useState(false);

  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState('');

  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState('');

  const goToClass = (classId: string) => {
    setJoining(true);
    router.push(`/join/${classId}/`);
  };

  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError('');
    const id = extractClassId(linkInput);
    if (!id) {
      setLinkError(
        "We couldn't find that class. Check the link and try again."
      );
      return;
    }
    goToClass(id);
  };

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError('');
    const id = extractClassId(codeInput);
    if (!id) {
      setCodeError(
        "We couldn't find that class. Check the code and try again."
      );
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
    <div className="space-y-8 max-w-2xl">
      {/* ── HEADER ─────────────────────────────────────────────── */}
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
          Use a link, class code, or QR code from your teacher.
        </p>
      </header>

      {/* ── MAIN CARD ─────────────────────────────────────────── */}
      <section className="surface-card rounded-2xl p-2 sm:p-3">
        {/* Segmented control */}
        <div
          role="tablist"
          aria-label="Join method"
          className="grid grid-cols-3 gap-1 rounded-xl bg-gray-50/80 border border-gray-100 p-1"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTab(t.id);
                  if (t.id !== 'qr') setScannerOpen(false);
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-all"
                style={
                  active
                    ? {
                        backgroundColor: '#fff',
                        color: BRAND,
                        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
                      }
                    : { color: '#6b7280' }
                }
              >
                <span className={active ? '' : 'opacity-70'}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Joining overlay state */}
        {joining ? (
          <div className="px-4 py-12 text-center space-y-3">
            <div
              className="mx-auto h-8 w-8 rounded-full border-4 animate-spin"
              style={{
                borderColor: BRAND,
                borderTopColor: 'transparent',
              }}
            />
            <p className="text-sm font-bold text-gray-900">
              Joining class…
            </p>
          </div>
        ) : (
          <div className="px-4 sm:px-5 py-5 space-y-4">
            {tab === 'link' && (
              <TabPanel
                title="Paste invite link"
                description="Use the full URL your teacher shared with you."
              >
                <form
                  onSubmit={handleLinkSubmit}
                  className="flex flex-col sm:flex-row gap-2"
                >
                  <input
                    type="text"
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    placeholder="https://.../join/..."
                    autoFocus
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                  <button
                    type="submit"
                    disabled={!linkInput.trim()}
                    className="inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50"
                    style={{ backgroundColor: BRAND }}
                  >
                    Join Class
                  </button>
                </form>
                {linkError && <ErrorLine message={linkError} />}
              </TabPanel>
            )}

            {tab === 'code' && (
              <TabPanel
                title="Enter class code"
                description="Your teacher can copy this from the class page."
              >
                <form
                  onSubmit={handleCodeSubmit}
                  className="flex flex-col sm:flex-row gap-2"
                >
                  <input
                    type="text"
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    placeholder="1a2b3c4d-...."
                    autoFocus
                    autoComplete="off"
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                  <button
                    type="submit"
                    disabled={!codeInput.trim()}
                    className="inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50"
                    style={{ backgroundColor: BRAND }}
                  >
                    Join Class
                  </button>
                </form>
                {codeError && <ErrorLine message={codeError} />}
              </TabPanel>
            )}

            {tab === 'qr' && (
              <TabPanel
                title="Scan QR code"
                description="Point your camera at the QR code your teacher is showing."
              >
                {!scannerOpen ? (
                  <button
                    onClick={() => {
                      setScanError('');
                      setScannerOpen(true);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
                    style={{ backgroundColor: BRAND }}
                  >
                    <IconCamera className="h-4 w-4" />
                    Open Camera
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-2xl overflow-hidden bg-black/85 max-w-sm aspect-square">
                      <Scanner
                        onScan={handleScan}
                        onError={(err) => {
                          const msg = (err as any)?.message || '';
                          setScanError(
                            msg.toLowerCase().includes('permission') ||
                              msg.toLowerCase().includes('notallowed')
                              ? 'Camera access is unavailable. Try joining with a link or code.'
                              : msg ||
                                  'Camera access is unavailable. Try joining with a link or code.'
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
                {scanError && <ErrorLine message={scanError} />}
              </TabPanel>
            )}
          </div>
        )}
      </section>

      <p className="text-xs text-gray-400 text-center max-w-xl mx-auto">
        Don't have a code? Ask your teacher to share an invite link or show
        you their class QR.
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function TabPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base md:text-lg font-black tracking-tight text-gray-900">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

function IconLink() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-4 w-4"
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
      className="h-4 w-4"
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
      className="h-4 w-4"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 4h2m4 0h-2m-4-4h2m2 4v2"
      />
    </svg>
  );
}

function IconCamera({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
      />
    </svg>
  );
}
