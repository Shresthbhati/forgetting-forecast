'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart2,
  BookOpen,
  ChevronLeft,
  FileText,
  FlaskConical,
  History,
  LayoutDashboard,
  MoreHorizontal,
  Settings,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SunsetSun } from '@/components/ui/SunsetSun';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shows the due-count badge */
  badge?: 'due';
}

/** Order: Dashboard, Review, Library, Sources, Analytics, History, Model Lab, Settings. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/review', label: 'Review', icon: Target, badge: 'due' },
  { href: '/library', label: 'Library', icon: BookOpen },
  { href: '/sources', label: 'Sources', icon: FileText },
  { href: '/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/history', label: 'History', icon: History },
  { href: '/model', label: 'Model Lab', icon: FlaskConical },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/** Concept pages belong to the Library; everything else matches by prefix (Dashboard only on "/"). */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/library' && pathname.startsWith('/concepts')) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function DueBadge({ count }: { count: number | null }) {
  if (!count) return null;
  return (
    <span
      aria-label={`${count} due`}
      className="ml-auto rounded bg-magenta px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-void"
    >
      {count}
    </span>
  );
}

interface SidebarProps {
  isOpen: boolean; // false = collapsed to icons
  onToggle: () => void;
  dueCount: number | null;
  displayName: string;
  isDemo: boolean;
}

/** Desktop sidebar (hidden under 1024px, where the bottom tab bar takes over). */
export function Sidebar({ isOpen, onToggle, dueCount, displayName, isDemo }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 hidden h-full flex-col overflow-hidden lg:flex',
        'border-r border-line bg-panel/90 backdrop-blur-md',
        'transition-[width] duration-300 ease-in-out',
        isOpen ? 'w-[var(--layout-sidebar-width)]' : 'w-[var(--layout-sidebar-collapsed-width)]'
      )}
    >
      <Link
        href="/"
        aria-label="Forgetting Forecast home"
        className={cn('flex items-center gap-3 border-b border-line px-4 py-5', !isOpen && 'justify-center px-2')}
      >
        <SunsetSun size={isOpen ? 36 : 32} />
        {isOpen && (
          <span className="leading-tight">
            <span className="block font-display text-sm font-black uppercase tracking-[0.12em] text-ink">Forgetting</span>
            <span className="block font-display text-sm font-black uppercase tracking-[0.12em] text-magenta text-glow-magenta">Forecast</span>
          </span>
        )}
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        {NAV_ITEMS.map(item => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={isOpen ? undefined : item.label}
              title={isOpen ? undefined : item.label}
              className={cn(
                'relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-brand-50 text-ink' : 'text-neutral-500 hover:bg-panel-hi hover:text-ink',
                !isOpen && 'justify-center px-2'
              )}
            >
              {active && (
                <span aria-hidden="true" className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-magenta shadow-[var(--glow-magenta)]" />
              )}
              <item.icon className={cn('h-5 w-5 shrink-0', active && 'text-magenta')} aria-hidden="true" />
              {isOpen && <span className="truncate">{item.label}</span>}
              {isOpen && item.badge === 'due' && <DueBadge count={dueCount} />}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-line p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={isOpen}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-neutral-500 transition-colors hover:bg-panel-hi hover:text-ink',
            !isOpen && 'justify-center px-2'
          )}
        >
          <ChevronLeft className={cn('h-5 w-5 shrink-0 transition-transform', !isOpen && 'rotate-180')} aria-hidden="true" />
          {isOpen && <span>Collapse</span>}
        </button>
        <div className={cn('flex items-center gap-3', !isOpen && 'justify-center')}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 font-mono text-sm font-semibold uppercase text-brand-700">
            {displayName[0] ?? 'U'}
          </span>
          {isOpen && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{displayName}</span>
              <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-ink-dim">
                {isDemo ? 'Sample data' : 'Synced to cloud'}
              </span>
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}

const TAB_ITEMS = NAV_ITEMS.filter(i => ['/', '/review', '/library', '/analytics'].includes(i.href));

/** Mobile bottom tab bar: Dashboard, Review, Library, Analytics, More. */
export function BottomTabBar({ dueCount, onMore }: { dueCount: number | null; onMore: () => void }) {
  const pathname = usePathname();
  const tab = 'relative flex flex-col items-center justify-center gap-1 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors';

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      {TAB_ITEMS.map(item => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(tab, active ? 'text-magenta' : 'text-neutral-500')}
          >
            <span className="relative">
              <item.icon className="h-5 w-5" aria-hidden="true" />
              {item.badge === 'due' && dueCount ? (
                <span aria-label={`${dueCount} due`} className="absolute -right-3 -top-2 rounded bg-magenta px-1 font-mono text-[9px] font-bold leading-4 text-void">
                  {dueCount}
                </span>
              ) : null}
            </span>
            {item.label}
          </Link>
        );
      })}
      <button type="button" onClick={onMore} className={cn(tab, 'text-neutral-500')} aria-haspopup="dialog">
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        More
      </button>
    </nav>
  );
}

/** Links shown in the mobile "More" dialog (everything not on the tab bar). */
export const MORE_ITEMS = NAV_ITEMS.filter(i => !TAB_ITEMS.includes(i));

Sidebar.displayName = 'Sidebar';

export default Sidebar;
