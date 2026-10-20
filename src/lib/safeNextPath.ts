/**
 * Open-redirect guard for the `next` query parameter of the auth callback.
 * Only same-site relative paths pass; everything else (including "//evil.com", "/\evil.com", "@evil.com" and
 * absolute URLs) falls back to "/".
 */
export function safeNextPath(next: string | null | undefined, origin: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  try {
    const target = new URL(next, origin);
    return target.origin === origin ? `${target.pathname}${target.search}` : '/';
  } catch {
    return '/';
  }
}
