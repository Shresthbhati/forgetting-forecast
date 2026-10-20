/**
 * Environment configuration with validation
 * All server-side environment variables should be accessed through this module
 */

import { z } from 'zod';

const envSchema = z.object({
  // Supabase (server-side only)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(), // server-only: account deletion + seed script; never used for ordinary user requests
  DEMO_PASSWORD: z.string().min(1).optional(), // server-only: lets /api/demo-login sign in the public demo account
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  // Feature flags
  ENABLE_ANALYTICS: z.coerce.boolean().default(false),
  ENABLE_EXPERIMENTAL_MODELS: z.coerce.boolean().default(false),
});

type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function getEnvSafe(): Env | null {
  try {
    return getEnv();
  } catch {
    return null;
  }
}

export const env = getEnvSafe();

export function assertEnv(): Env {
  const e = getEnvSafe();
  if (!e) {
    throw new Error('Environment not configured. Check .env.local or deployment config.');
  }
  return e;
}