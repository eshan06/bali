'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthContext } from '@/components/auth/AuthProvider';

const BRAND = '#2E5BD0';

const navItems = [
  {
    href: '/dashboard/',
    label: 'Dashboard',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  },
  {
    href: '/dashboard/classes/',
    label: 'Classes',
    icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  },
  {
    href: '/dashboard/session/',
    label: 'Active Session',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    href: '/dashboard/devices/',
    label: 'Devices',
    icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthContext();

  return (
    <aside className="flex h-full w-64 flex-col bg-white/55 backdrop-blur-xl border-r border-white/60">
      {/* Logo */}
      <div className="flex h-20 items-center px-6">
        <Link
          href="/dashboard/"
          className="text-3xl font-black tracking-tight lowercase transition-opacity hover:opacity-80"
          style={{ color: BRAND }}
        >
          bali
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/dashboard/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:bg-white/70 hover:text-gray-900'
              }`}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full"
                  style={{ backgroundColor: BRAND }}
                  aria-hidden
                />
              )}
              <svg
                className="h-5 w-5 flex-shrink-0 transition-colors"
                style={{ color: isActive ? BRAND : undefined }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.7}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-white/55 p-4">
        <div className="chip-outline rounded-2xl p-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: BRAND }}
            >
              {user?.displayName?.charAt(0)?.toUpperCase() || 'T'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {user?.displayName || 'Teacher'}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="mt-3 w-full rounded-xl bg-white/80 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-white"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
