/**
 * Refreshes the Supabase session cookies on every request and sends signed-out page requests to sign-in.
 * API routes are left alone: they return their own 401 JSON.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// /dev is the UI QA sheet; the page itself returns 404 in production.
const PUBLIC_PAGE_PREFIXES = ['/auth', '/welcome', '/dev'];

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: cookiesToSet => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() validates the token with Supabase and refreshes it when it is about to expire.
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const isPublic = PUBLIC_PAGE_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`));
  if (!user && !isApi && !isPublic) {
    const welcome = request.nextUrl.clone();
    welcome.pathname = '/welcome';
    welcome.search = '';
    return NextResponse.redirect(welcome);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
