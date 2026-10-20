'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle, Loader2, Mail } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { safeNextPath } from '@/lib/safeNextPath';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/Button';

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const callbackUrl = safeNextPath(searchParams.get('callbackUrl'), window.location.origin);
    const supabase = getSupabaseBrowserClient();
    const code = searchParams.get('code');
    const type = searchParams.get('type');

    if (!code) {
      setStatus('error');
      setMessage('No verification code provided');
      return;
    }

    const verify = async () => {
      try {
        const { error } = await supabase.auth.verifyOtp({ token_hash: code, type: type as any });
        if (error) {
          setStatus('error');
          setMessage(error.message);
        } else {
          setStatus('success');
          setMessage('Email verified successfully!');
          setTimeout(() => router.push(callbackUrl), 1500);
        }
      } catch {
        setStatus('error');
        setMessage('Verification failed. Please try signing in again.');
      }
    };

    verify();
  }, [searchParams, router]);

  if (status === 'verifying') {
    return (
      <div className="space-y-3 py-4 text-center" role="status">
        <Loader2 className="mx-auto h-9 w-9 animate-spin text-magenta" aria-hidden="true" />
        <h1 className="font-display text-xl font-bold uppercase tracking-[0.1em] text-ink">Verifying your email</h1>
        <p className="text-sm text-ink-dim">Please wait while we confirm your email address…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2 text-center">
      {status === 'success' ? (
        <CheckCircle className="mx-auto h-12 w-12 text-strong" aria-hidden="true" />
      ) : (
        <Mail className="mx-auto h-12 w-12 text-due" aria-hidden="true" />
      )}
      <h1 className="font-display text-xl font-bold uppercase tracking-[0.1em] text-ink">
        {status === 'success' ? 'Email verified' : 'Verification failed'}
      </h1>
      <p className="text-sm text-ink-dim">
        {message || (status === 'success' ? 'You can now sign in to your account' : 'Please try signing up again or request a new link')}
      </p>
      {status === 'success' && <p className="font-mono text-xs text-ink-dim">Redirecting…</p>}
      {status === 'error' && (
        <div className="flex justify-center gap-3 pt-2">
          <Link href="/auth/signin">
            <Button variant="secondary">Sign in</Button>
          </Link>
          <Link href="/auth/signup">
            <Button>Sign up</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <AuthLayout title="VERIFY.EXE">
      <Suspense fallback={null}>
        <VerifyContent />
      </Suspense>
    </AuthLayout>
  );
}
