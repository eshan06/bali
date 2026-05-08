'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthContext } from '@/components/auth/AuthProvider';

const BRAND = '#2E5BD0';

const navItems = [
  { href: '/student/', label: 'Classes' },
  { href: '/student/join/', label: 'Join' },
  { href: '/student/profile/', label: 'Profile' },
];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, role, user, logout } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login/');
      return;
    }
    if (role === 'teacher') {
      router.replace('/dashboard/');
      return;
    }
    if (role === 'unset') {
      router.replace('/onboarding/');
      return;
    }
    if (role === 'student' && !user?.student) {
      router.replace('/onboarding/profile/');
      return;
    }
  }, [isAuthenticated, isLoading, role, user, router]);

  if (isLoading || !isAuthenticated || role !== 'student' || !user?.student) {
    return (
      <div className="bg-dash flex min-h-screen items-center justify-center">
        <div
          className="animate-spin h-8 w-8 border-4 border-t-transparent rounded-full"
          style={{ borderColor: BRAND, borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  const student = user.student;
  const isActiveLink = (href: string) =>
    href === '/student/'
      ? pathname === '/student/' || pathname === '/student'
      : pathname?.startsWith(href);

  return (
    <div className="bg-dash min-h-screen">
      <header className="px-6 sm:px-8 pt-5 pb-1">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-6">
          <div className="flex items-center gap-8">
            <Link
              href="/student/"
              className="text-2xl font-black tracking-tight text-gray-900 lowercase"
            >
              bali
            </Link>
            <nav className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => {
                const active = isActiveLink(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-full px-4 py-1.5 text-sm font-bold transition-colors"
                    style={
                      active
                        ? {
                            backgroundColor: 'rgba(46, 91, 208, 0.10)',
                            color: BRAND,
                          }
                        : { color: '#374151' }
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-sm">
              <span className="font-bold text-gray-900">
                {student.firstName} {student.lastName}
              </span>
              {student.grade ? (
                <span className="text-gray-400"> · {student.grade}</span>
              ) : null}
            </span>
            <button
              onClick={logout}
              className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Mobile nav row */}
        <div className="max-w-5xl mx-auto mt-4 sm:hidden flex items-center gap-1">
          {navItems.map((item) => {
            const active = isActiveLink(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-1.5 text-sm font-bold transition-colors"
                style={
                  active
                    ? {
                        backgroundColor: 'rgba(46, 91, 208, 0.10)',
                        color: BRAND,
                      }
                    : { color: '#374151' }
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 sm:px-8 pt-10 pb-16">
        {children}
      </main>
    </div>
  );
}
