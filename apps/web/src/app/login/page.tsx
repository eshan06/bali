'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Chrome } from 'lucide-react';
import { ArcMark } from '@/components/bali/ArcMark';
import { Button, FieldError, Input, Label } from '@/components/bali/Button';
import { ICON_STROKE } from '@/components/bali/icons';
import { useAuth } from '@/lib/auth';

/** W1 · /login — quiet, brand-forward, zero marketing. */
export default function LoginPage() {
  const router = useRouter();
  const { teacher, loading, signInWithPassword, signInWithGoogle, devSignIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && teacher) router.replace('/app');
  }, [loading, teacher, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithPassword(email, password);
      router.replace('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed — check your email and password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex w-[380px] flex-col gap-[22px]">
        <div className="flex flex-col items-center gap-3">
          <ArcMark size={40} />
          <div className="text-[24px] font-semibold leading-[30px]">Bali</div>
          <div className="text-[14px] leading-5 text-ink-secondary">Focus sessions for your classroom</div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-line bg-surface-card p-6">
          <div>
            <Label className="mb-1.5">Email</Label>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label className="mb-1.5">Password</Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              error={!!error}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </div>
          <Button type="submit" loading={busy} className="mt-1 w-full py-[11px]">
            Sign in
          </Button>
          <div className="flex items-center gap-2.5 text-[12px] leading-4 text-ink-tertiary">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full py-[11px]"
            onClick={() => void signInWithGoogle()}
          >
            <Chrome size={16} strokeWidth={ICON_STROKE} />
            Continue with Google
          </Button>
        </form>

        <div className="text-center text-[12.5px] leading-[17px] text-ink-tertiary">
          Students don&apos;t sign in here — they use the iOS app.
        </div>

        {devSignIn ? (
          <button
            type="button"
            className="text-center text-[12px] text-ink-tertiary underline decoration-dotted hover:text-ink-secondary"
            onClick={() => {
              void devSignIn('dev:t-sandbox:sandbox-teacher@bali.dev:Sandbox Teacher').then(() => router.replace('/app'));
            }}
          >
            Dev sign-in (local only)
          </button>
        ) : null}
      </div>
    </main>
  );
}
