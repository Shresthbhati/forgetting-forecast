'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, Menu, Play, Search, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { NAV_ITEMS, isActivePath } from './Sidebar';

interface HeaderProps {
  onMenuClick: () => void;
  sidebarOpen: boolean;
  dueCount: number | null;
  displayName: string;
  isDemo: boolean;
}

/** "LIBRARY / CONCEPT" style breadcrumb in mono caps. */
function breadcrumb(pathname: string): string[] {
  const section = NAV_ITEMS.find(i => isActivePath(pathname, i.href));
  const parts = [section?.label ?? 'App'];
  if (pathname.startsWith('/concepts/')) parts.push('Concept');
  return parts;
}

export function Header({ onMenuClick, sidebarOpen, dueCount, displayName, isDemo }: HeaderProps) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setShowUserMenu(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth/signin');
    router.refresh();
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/library?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
    }
  };

  const crumbs = breadcrumb(pathname);
  const onReview = pathname.startsWith('/review');

  return (
    <header
      role="banner"
      className={cn(
        'fixed right-0 top-0 z-30 flex h-[var(--layout-header-height)] w-full items-center justify-between gap-3',
        'border-b border-line bg-panel/90 px-4 backdrop-blur-md lg:px-6',
        'transition-[left,width] duration-300 ease-in-out',
        sidebarOpen
          ? 'lg:w-[calc(100%-var(--layout-sidebar-width))]'
          : 'lg:w-[calc(100%-var(--layout-sidebar-collapsed-width))]'
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-md p-2 text-neutral-500 transition-colors hover:bg-panel-hi hover:text-ink lg:hidden"
          aria-label="Open menu"
          aria-haspopup="dialog"
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>

        <nav aria-label="Breadcrumb" className="min-w-0 overflow-hidden">
          <ol className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-dim">
            <li className="hidden xl:block">Forgetting_Forecast</li>
            {crumbs.map((c, i) => (
              <li key={c} className="flex items-center gap-2">
                <span aria-hidden="true" className={cn('hidden text-line', i === 0 ? 'xl:inline' : 'sm:inline')}>/</span>
                <span aria-current={i === crumbs.length - 1 ? 'page' : undefined} className={cn('truncate', i === crumbs.length - 1 && 'text-ink')}>
                  {c}
                </span>
              </li>
            ))}
          </ol>
        </nav>

        {isDemo && (
          <span className="shrink-0 rounded border border-sunset/50 bg-sunset/10 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-sunset">
            SAMPLE DATA
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 lg:gap-3">
        <form onSubmit={handleSearch} className="relative hidden 2xl:block" role="search">
          <label htmlFor="global-search" className="sr-only">Search concepts</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
          <input
            type="search"
            id="global-search"
            placeholder="Search concepts"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-56 rounded-md border border-line bg-night py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-neutral-400 transition-[border-color,box-shadow] focus:border-cyan focus:outline-none focus:shadow-[var(--glow-cyan)]"
          />
        </form>

        {!onReview && (
          <Link href="/review" className="hidden sm:block">
            <Button size="sm" aria-label={dueCount ? `Start review, ${dueCount} due` : 'Start review'}>
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Start review{dueCount ? ` (${dueCount} due)` : ''}
            </Button>
          </Link>
        )}

        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setShowUserMenu(v => !v)}
            className={cn(
              'flex items-center gap-2 rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-panel-hi hover:text-ink',
              showUserMenu && 'bg-panel-hi'
            )}
            aria-label="User menu"
            aria-expanded={showUserMenu}
            aria-haspopup="menu"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 font-mono text-sm font-semibold uppercase text-brand-700">
              {displayName[0] ?? 'U'}
            </span>
            <span className="hidden max-w-[120px] truncate text-sm font-medium text-ink md:block">{displayName}</span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', showUserMenu && 'rotate-180')} aria-hidden="true" />
          </button>

          {showUserMenu && (
            <div role="menu" className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-line bg-panel py-1.5 shadow-[0_16px_48px_rgb(0_0_0/0.6)]">
              <div className="border-b border-line px-3 py-2">
                <p className="truncate text-sm font-medium text-ink">{displayName}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-ink-dim">{user?.email}</p>
              </div>
              <Link
                href="/settings"
                role="menuitem"
                onClick={() => setShowUserMenu(false)}
                className="flex items-center gap-3 px-3 py-2 text-sm text-ink hover:bg-panel-hi"
              >
                <Settings className="h-4 w-4 text-neutral-400" aria-hidden="true" />
                Settings
              </Link>
              <button type="button" role="menuitem" onClick={handleSignOut} className="flex w-full items-center gap-3 px-3 py-2 text-sm text-danger-600 hover:bg-danger-50">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

Header.displayName = 'Header';

export default Header;
