/**
 * Supabase server-side client
 * Use this in API routes and server actions
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';

export async function createSupabaseServerClient() {
  const env = getEnv();
  const cookieStore = await cookies();

  // Anon key + user cookies so Row Level Security applies to every query.
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Ignore cookie errors in server components
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {
          // Ignore cookie errors in server components
        }
      },
    },
  });
}

export async function getUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return null;
  return user;
}

export async function getUserId(): Promise<string | null> {
  const user = await getUser();
  return user?.id ?? null;
}