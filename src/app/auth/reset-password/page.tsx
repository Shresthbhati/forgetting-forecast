'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle, Lock } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push('/auth/signin'), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="NEW_PASSWORD.EXE">
      <div className="mb-5 text-center">
        {success ? <CheckCircle className="mx-auto mb-3 h-10 w-10 text-strong" aria-hidden="true" /> : <Lock className="mx-auto mb-3 h-10 w-10 text-magenta" aria-hidden="true" />}
        <h1 className="font-display text-xl font-bold uppercase tracking-[0.1em] text-chrome">{success ? 'Password updated' : 'Reset password'}</h1>
        <p className="mt-2 text-sm text-ink-dim">{success ? 'Redirecting to sign in…' : 'Enter your new password below'}</p>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-danger-200 bg-danger-50 px-3 py-2.5 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {!success && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="New password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter new password"
            autoComplete="new-password"
            required
            helperText="Must be at least 8 characters"
          />
          <Input
            label="Confirm password"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            required
          />
          <label className="flex items-center gap-2 text-sm text-ink-dim">
            <input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} className="h-4 w-4 accent-magenta" />
            Show password
          </label>
          <Button type="submit" size="lg" fullWidth loading={loading}>
            {loading ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}

      <p className="mt-5 text-center text-sm text-ink-dim">
        Remember your password?{' '}
        <Link href="/auth/signin" className="font-semibold text-cyan hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
