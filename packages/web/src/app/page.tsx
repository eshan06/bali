'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthContext } from '@/components/auth/AuthProvider';

export default function LandingPage() {
  const { isAuthenticated, isLoading } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/dashboard/');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-xl font-bold text-gray-900 tracking-tight">bali</span>
          <Link
            href="/login/"
            className="rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20">
        <div className="max-w-3xl">
          <h1 className="text-5xl font-extrabold text-gray-900 tracking-tight leading-tight">
            Keep your classroom
            <span className="text-primary-600"> focused.</span>
          </h1>
          <p className="mt-6 text-xl text-gray-500 leading-relaxed max-w-2xl">
            Bali gives teachers real-time attendance tracking and device management in one simple dashboard.
            Students tap in, apps get blocked, and you stay in control.
          </p>
          <div className="mt-10 flex items-center gap-4">
            <Link
              href="/login/"
              className="rounded-xl bg-primary-600 px-8 py-3.5 text-base font-semibold text-white hover:bg-primary-700 transition-colors shadow-sm"
            >
              Get Started
            </Link>
            <a
              href="#features"
              className="rounded-xl border border-gray-300 px-8 py-3.5 text-base font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <h2 className="text-3xl font-bold text-gray-900 text-center">Everything you need to run a productive class</h2>
          <p className="mt-4 text-gray-500 text-center max-w-xl mx-auto">
            No complicated setup. Just create a class, add students, and start a session.
          </p>

          <div className="mt-16 grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-8">
              <div className="h-12 w-12 rounded-xl bg-green-100 flex items-center justify-center">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-gray-900">Instant Attendance</h3>
              <p className="mt-3 text-gray-500 leading-relaxed">
                Students tap in with their device and attendance is recorded automatically. No more calling names or passing around a sign-in sheet.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-8">
              <div className="h-12 w-12 rounded-xl bg-red-100 flex items-center justify-center">
                <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-gray-900">App Blocking</h3>
              <p className="mt-3 text-gray-500 leading-relaxed">
                Block distracting apps during class with one click. Choose from presets like Full Focus, No Social Media, or create your own custom policy.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-8">
              <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center">
                <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
                </svg>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-gray-900">Live Dashboard</h3>
              <p className="mt-3 text-gray-500 leading-relaxed">
                See who's checked in, who's late, and whose device is blocked — all in real time. Override attendance or blocking status for any student.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <h2 className="text-3xl font-bold text-gray-900 text-center">How it works</h2>

          <div className="mt-16 grid md:grid-cols-4 gap-6">
            {[
              { step: '1', title: 'Create a class', desc: 'Add your students manually or import from a CSV.' },
              { step: '2', title: 'Set blocking policy', desc: 'Pick a preset or customize which apps to block.' },
              { step: '3', title: 'Start a session', desc: 'Blocking activates automatically. Students tap in.' },
              { step: '4', title: 'Teach', desc: 'Monitor attendance and focus from your dashboard.' },
            ].map(item => (
              <div key={item.step} className="text-center">
                <div className="mx-auto h-12 w-12 rounded-full bg-primary-100 text-primary-700 font-bold text-lg flex items-center justify-center">
                  {item.step}
                </div>
                <h3 className="mt-4 font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary-600">
        <div className="max-w-6xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold text-white">Ready to take back your classroom?</h2>
          <p className="mt-4 text-primary-100 text-lg max-w-lg mx-auto">
            Sign up in seconds. No credit card required.
          </p>
          <Link
            href="/login/"
            className="mt-8 inline-block rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-primary-700 hover:bg-primary-50 transition-colors shadow-sm"
          >
            Get Started Free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between">
          <span className="text-sm text-gray-400">Bali</span>
          <span className="text-sm text-gray-400">Built for teachers, by students.</span>
        </div>
      </footer>
    </div>
  );
}
