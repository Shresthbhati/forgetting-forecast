/**
 * Supabase browser client
 * Use this in client components only
 */

import { createBrowserClient } from '@supabase/ssr';

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  // Literal process.env.NEXT_PUBLIC_* references are the only env reads Next inlines into client bundles.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Environment not configured for browser client');
  }

  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}

export function getSupabaseBrowserClient() {
  return createSupabaseBrowserClient();
}