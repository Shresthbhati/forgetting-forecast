'use client';

import Link from 'next/link';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/Button';

export default function AuthCodeErrorPage() {
  return (
    <AuthLayout title="ERROR.EXE">
      <div className="space-y-4 py-2 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-due" aria-hidden="true" />
        <h1 className="font-display text-xl font-bold uppercase tracking-[0.1em] text-ink">Authentication error</h1>
        <p className="text-sm text-ink-dim">We couldn&apos;t verify your authentication code. This link may have expired or already been used.</p>
        <div className="flex justify-center gap-3 pt-2">
          <Link href="/auth/signin">
            <Button variant="secondary">
              <ArrowLeft size={14} aria-hidden="true" />
              Sign in
            </Button>
          </Link>
          <Link href="/auth/signup">
            <Button>Create account</Button>
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
