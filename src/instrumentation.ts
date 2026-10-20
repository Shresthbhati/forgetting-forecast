/**
 * Runs once when the server starts. Validates the environment up front so a missing variable fails the boot
 * with a clear message instead of failing on the first request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('@/lib/env');
    getEnv();
  }
}
