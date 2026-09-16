'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  signUp,
  confirmSignUp,
  resendSignUpCode,
  signIn,
  fetchAuthSession,
} from 'aws-amplify/auth';
import { useAuthContext } from '@/components/auth/AuthProvider';
import type { UserRole } from '@bali/shared';

type Step = 'form' | 'confirm';

const PENDING_ROLE_KEY = 'bali:pendingSignupRole';
const PENDING_REDIRECT_KEY = 'bali:pendingRedirect';

function routeForRole(role: string | null | undefined, redirect: string | null): string {
  if (redirect && (role === 'teacher' || role === 'student')) return redirect;
  if (role === 'teacher') return '/dashboard/';
  if (role === 'student') {
    return redirect ? `/onboarding/profile/?redirect=${encodeURIComponent(redirect)}` : '/student/';
  }
  return redirect ? `/onboarding/?redirect=${encodeURIComponent(redirect)}` : '/onboarding/';
}

function SignupPageInner() {
  const { loginWithGoogle, isAuthenticated, role: currentRole } = useAuthContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect');

  const [step, setStep] = useState<Step>('form');
  const [role, setRole] = useState<UserRole>('teacher');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated && currentRole) {
      router.replace(routeForRole(currentRole, redirect));
    }
  }, [isAuthenticated, currentRole, router, redirect]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signUp({
        username: email,
        password,
        options: {
          userAttributes: {
            email,
            'custom:role': role,
          },
        },
      });
      setStep('confirm');
      setInfo(`We sent a confirmation code to ${email}.`);
    } catch (err: any) {
      setError(err.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      await signIn({ username: email, password });
      const session = await fetchAuthSession();
      const claimRole = session.tokens?.idToken?.payload?.['custom:role'] as string | undefined;
      router.push(routeForRole(claimRole ?? role, redirect));
    } catch (err: any) {
      setError(err.message || 'Confirmation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setInfo('');
    try {
      await resendSignUpCode({ username: email });
      setInfo('We sent a new code.');
    } catch (err: any) {
      setError(err.message || 'Could not resend code');
    }
  };

  const handleGoogleSignup = async (chosenRole: UserRole) => {
    try {
      window.sessionStorage.setItem(PENDING_ROLE_KEY, chosenRole);
      if (redirect) {
        window.sessionStorage.setItem(PENDING_REDIRECT_KEY, redirect);
      }
    } catch {}
    await loginWithGoogle();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-primary-600">Bali</h1>
          <p className="mt-2 text-gray-600">Create your account</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          {step === 'form' ? (
            <>
              <h2 className="text-xl font-semibold mb-6">Sign up</h2>

              {error && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
              )}

              <form onSubmit={handleSignUp} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">I am a</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setRole('teacher')}
                      className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                        role === 'teacher'
                          ? 'border-primary-600 bg-primary-50 text-primary-700'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Teacher
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('student')}
                      className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                        role === 'student'
                          ? 'border-primary-600 bg-primary-50 text-primary-700'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Student
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    placeholder="you@school.edu"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    placeholder="At least 8 characters"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-white font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Creating account...' : 'Create account'}
                </button>
              </form>

              <div className="mt-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="bg-white px-2 text-gray-500">Or sign up with Google as</span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleGoogleSignup('teacher')}
                    className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <GoogleIcon /> Teacher
                  </button>
                  <button
                    onClick={() => handleGoogleSignup('student')}
                    className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <GoogleIcon /> Student
                  </button>
                </div>
              </div>

              <p className="mt-6 text-center text-sm text-gray-500">
                Already have an account?{' '}
                <Link
                  href={redirect ? `/login/?redirect=${encodeURIComponent(redirect)}` : '/login/'}
                  className="font-medium text-primary-600 hover:text-primary-700"
                >
                  Sign in
                </Link>
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold mb-2">Confirm your email</h2>
              <p className="text-sm text-gray-500 mb-6">
                Enter the 6-digit code we sent to <span className="font-medium">{email}</span>.
              </p>

              {error && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
              )}
              {info && !error && (
                <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</div>
              )}

              <form onSubmit={handleConfirm} className="space-y-4">
                <input
                  id="code"
                  type="text"
                  required
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-2xl tracking-widest focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  placeholder="______"
                />

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-white font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Confirming...' : 'Confirm'}
                </button>
              </form>

              <button
                onClick={handleResend}
                className="mt-4 w-full text-sm text-primary-600 hover:text-primary-700"
              >
                Resend code
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// useSearchParams() needs a Suspense boundary above it or the production
// build fails when prerendering this route.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}
