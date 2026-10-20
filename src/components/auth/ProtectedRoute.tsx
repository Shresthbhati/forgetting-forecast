'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode | ((props: { user: any; loading: boolean }) => React.ReactNode);
  fallback?: React.ReactNode;
}

/** Client-side guard for session expiry; the middleware already redirects signed-out page requests to /welcome. */
export function ProtectedRoute({ children, fallback }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/welcome');
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-ink-dim" role="status" aria-label="Loading">
        <Loader2 className="h-8 w-8 animate-spin text-magenta" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (!user) return fallback ?? null;

  if (typeof children === 'function') return <>{children({ user, loading })}</>;
  return <>{children}</>;
}
