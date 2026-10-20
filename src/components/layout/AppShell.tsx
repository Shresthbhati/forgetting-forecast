'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Dialog } from '@/components/ui/Dialog';
import { Sidebar, BottomTabBar, MORE_ITEMS, isActivePath } from './Sidebar';
import { Header } from './Header';

/** Routes that render without the app chrome (they bring their own background). */
const BARE_PREFIXES = ['/auth', '/welcome', '/dev'];
const COLLAPSE_KEY = 'ff:sidebar-collapsed';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * The shell renders on the server and adapts with CSS (sidebar >= 1024px, bottom tab bar below), so there is no
 * mount spinner or layout shift. Only the collapsed preference and the due count are read after mount.
 */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const bare = BARE_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`));

  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dueCount, setDueCount] = useState<number | null>(null);
  const [profile, setProfile] = useState<{ name: string | null; isDemo: boolean }>({ name: null, isDemo: false });

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* storage unavailable: default to expanded */
    }
  }, []);

  // Due count for the badges: refreshed on every navigation (a finished review changes it).
  useEffect(() => {
    if (bare || !user) return;
    let cancelled = false;
    api.dashboard().then(d => !cancelled && setDueCount(d.dueConcepts)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bare, user, pathname]);

  useEffect(() => {
    if (bare || !user) return;
    let cancelled = false;
    api.me.get().then(me => !cancelled && setProfile({ name: me.displayName, isDemo: me.isDemo })).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bare, user]);

  const toggleSidebar = () =>
    setCollapsed(prev => {
      try {
        localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !prev;
    });

  if (bare) return <>{children}</>;

  const displayName = profile.name || user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'User';

  return (
    <ProtectedRoute>
      <div className="relative min-h-screen bg-night">
        <div className="synth-grid" aria-hidden="true" />
        <div className="synth-horizon" aria-hidden="true" />

        <Sidebar isOpen={!collapsed} onToggle={toggleSidebar} dueCount={dueCount} displayName={displayName} isDemo={profile.isDemo} />

        <div
          className={cn(
            'relative z-10 min-h-screen transition-[margin] duration-300 ease-in-out',
            collapsed ? 'lg:ml-[var(--layout-sidebar-collapsed-width)]' : 'lg:ml-[var(--layout-sidebar-width)]'
          )}
        >
          <Header
            onMenuClick={() => setMenuOpen(true)}
            sidebarOpen={!collapsed}
            dueCount={dueCount}
            displayName={displayName}
            isDemo={profile.isDemo}
          />
          <main
            role="main"
            className="min-h-[calc(100vh-var(--layout-header-height))] pt-[var(--layout-header-height)] pb-24 lg:pb-12"
          >
            <div className="container pt-6">{children}</div>
          </main>
        </div>

        <BottomTabBar dueCount={dueCount} onMore={() => setMenuOpen(true)} />

        <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="MENU.EXE">
          <nav aria-label="More" className="space-y-1">
            {MORE_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors hover:bg-panel-hi',
                  isActivePath(pathname, item.href) ? 'bg-brand-50 text-ink' : 'text-neutral-600'
                )}
              >
                <item.icon className="h-5 w-5 text-magenta" aria-hidden="true" />
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={async () => {
                setMenuOpen(false);
                await signOut();
                window.location.assign('/auth/signin');
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm font-medium text-danger-600 hover:bg-danger-50"
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
              Sign out
            </button>
          </nav>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}

export default AppShell;
