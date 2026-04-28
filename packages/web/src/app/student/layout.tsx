'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthContext } from '@/components/auth/AuthProvider';

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
      <div className="bg-aurora flex min-h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const student = user.student;

  return (
    <div className="bg-aurora min-h-screen">
      <header className="px-8 pt-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
          <div className="flex items-center gap-8">
            <Link
              href="/student/"
              className="text-3xl font-bold text-primary-600 tracking-tight lowercase"
            >
              bali
            </Link>
            <nav className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive =
                  item.href === '/student/'
                    ? pathname === '/student/' || pathname === '/student'
                    : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-white/80 text-primary-700 shadow-sm'
                        : 'text-gray-700 hover:bg-white/40'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-gray-700">
              <span className="font-medium text-gray-900">
                {student.firstName} {student.lastName}
              </span>
              {student.grade ? <span className="text-gray-500"> · {student.grade}</span> : null}
            </span>
            <button
              onClick={logout}
              className="chip-outline rounded-xl px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-white/90 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Mobile nav row */}
        <div className="max-w-7xl mx-auto mt-4 sm:hidden flex items-center gap-1">
          {navItems.map((item) => {
            const isActive =
              item.href === '/student/'
                ? pathname === '/student/' || pathname === '/student'
                : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/80 text-primary-700 shadow-sm'
                    : 'text-gray-700 hover:bg-white/40'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 pt-10 pb-16">{children}</main>
    </div>
  );
}
