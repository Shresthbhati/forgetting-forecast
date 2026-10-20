/**
 * In-memory token-bucket rate limiter for write routes (about 60 requests a minute per user per scope).
 */

import { getUserId } from '@/server/db/supabase';
import { TooManyRequestsError } from '@/server/errors';

const LIMIT_PER_MINUTE = 60;
const buckets = new Map<string, { tokens: number; updatedAt: number }>();

/** Returns true when the request may proceed. Pure apart from the module-level bucket map; `now` is injectable for tests. */
export function takeToken(key: string, now = Date.now(), limit = LIMIT_PER_MINUTE): boolean {
  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  const refilled = Math.min(limit, bucket.tokens + ((now - bucket.updatedAt) / 60_000) * limit);
  if (refilled < 1) {
    buckets.set(key, { tokens: refilled, updatedAt: now });
    return false;
  }
  buckets.set(key, { tokens: refilled - 1, updatedAt: now });
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Call at the top of a write route. Signed-out callers are skipped here (the service returns 401).
 * ponytail: per-instance memory; move to Upstash/Redis if deployed multi-instance.
 */
export async function enforceWriteRateLimit(scope: string): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;
  if (!takeToken(`${scope}:${userId}`)) throw new TooManyRequestsError();
}
