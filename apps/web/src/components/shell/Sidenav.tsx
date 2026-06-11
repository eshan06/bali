'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChartColumn,
  House,
  LayoutGrid,
  ListChecks,
  LogOut,
  Nfc,
  ScrollText,
  Settings,
} from 'lucide-react';
import { ArcMark } from '../bali/ArcMark';
import { ICON_STROKE } from '../bali/icons';
import { useAuth } from '@/lib/auth';

const NAV = [
  { href: '/app', label: 'Home', icon: House, exact: true },
  { href: '/app/classes', label: 'Classes', icon: LayoutGrid },
  { href: '/app/policies', label: 'Policies', icon: ListChecks },
  { href: '/app/tags', label: 'Tags', icon: Nfc },
  { href: '/app/reports', label: 'Reports', icon: ChartColumn },
  { href: '/app/logs', label: 'Logs', icon: ScrollText },
  { href: '/app/settings', label: 'Settings', icon: Settings },
];

export function Sidenav() {
  const pathname = usePathname();
  const router = useRouter();
  const { teacher, signOut } = useAuth();

  const initials = (teacher?.displayName ?? 'B')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, '').charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside className="sticky top-0 flex h-screen w-[216px] flex-none flex-col gap-0.5 border-r border-line bg-surface-card px-3 pb-3 pt-8">
      <div className="flex items-center gap-[9px] px-2.5 pb-[18px] pt-1 text-[16px] font-semibold leading-[22px]">
        <ArcMark size={18} />
        Bali
      </div>
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={clsx(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] leading-5',
              active
                ? 'bg-surface-sunken font-semibold text-ink-primary'
                : 'font-medium text-ink-secondary hover:bg-surface-sunken',
            )}
          >
            <Icon size={17} strokeWidth={ICON_STROKE} />
            {label}
          </Link>
        );
      })}
      <div className="mt-auto flex items-center gap-[9px] border-t border-line p-2.5">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-green-200 text-[11px] font-semibold text-green-800">
          {initials}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-[17px]">{teacher?.displayName}</span>
          <span className="block truncate text-[11.5px] leading-[15px] text-ink-tertiary">{teacher?.schoolName}</span>
        </span>
        <button
          type="button"
          aria-label="Sign out"
          onClick={() => {
            void signOut().then(() => router.replace('/login'));
          }}
          className="ml-auto flex text-ink-tertiary hover:text-ink-secondary"
        >
          <LogOut size={15} strokeWidth={ICON_STROKE} />
        </button>
      </div>
    </aside>
  );
}
