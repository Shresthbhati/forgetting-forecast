'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle, Eye, EyeOff, Lock, Mail, Play } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { safeNextPath } from '@/lib/safeNextPath';
import { cn } from '@/lib/utils';

const fieldClasses =
  'w-full rounded-md border border-line bg-night py-2.5 pl-11 pr-11 text-sm text-ink placeholder:text-neutral-400 ' +
  'hover:border-neutral-400 focus:border-cyan focus:outline-none focus:shadow-[var(--glow-cyan)] transition-[border-color,box-shadow]';

function AuthField({
  icon: Icon,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  showToggle,
  showPassword,
  onToggleShowPassword,
}: {
  icon: React.ElementType;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete?: string;
  showToggle?: boolean;
  showPassword?: boolean;
  onToggleShowPassword?: () => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-neutral-400" aria-hidden="true" />
        <input
          id={id}
          type={showToggle && showPassword ? 'text' : type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          className={fieldClasses}
        />
        {showToggle && (
          <button
            type="button"
            onClick={onToggleShowPassword}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-ink"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5 text-center">
      <h1 className="font-display text-xl font-bold uppercase tracking-[0.1em] text-chrome">{title}</h1>
      <p className="mt-2 text-sm text-ink-dim">{subtitle}</p>
    </div>
  );
}

function Message({ kind, children }: { kind: 'error' | 'success'; children: React.ReactNode }) {
  const Icon = kind === 'error' ? AlertCircle : CheckCircle;
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm',
        kind === 'error' ? 'border-danger-200 bg-danger-50 text-danger-700' : 'border-success-200 bg-success-50 text-success-700'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
    </div>
  );
}

const footerLink = 'font-semibold text-cyan hover:underline';

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  // Only same-site paths are honoured, so ?callbackUrl=https://evil.com cannot bounce the user off-site.
  const callbackUrl = safeNextPath(searchParams.get('callbackUrl'), typeof window === 'undefined' ? '' : window.location.origin);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const { error } = await signIn(email, password);
    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  };

  const handleDemo = async () => {
    setError('');
    setDemoLoading(true);
    try {
      const res = await fetch('/api/demo-login', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Demo sign-in failed');
      }
      // Full navigation: the server set the session cookie, and AuthProvider must re-initialise to see it.
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo sign-in failed');
      setDemoLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Header title="Sign in" subtitle="Enter your credentials to access your forecast" />
      {error && <Message kind="error">{error}</Message>}

      <AuthField icon={Mail} type="email" label="Email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" />
      <AuthField
        icon={Lock}
        type="password"
        label="Password"
        value={password}
        onChange={setPassword}
        placeholder="••••••••"
        autoComplete="current-password"
        showToggle
        showPassword={showPassword}
        onToggleShowPassword={() => setShowPassword(v => !v)}
      />

      <div className="text-right">
        <Link href="/auth/forgot-password" className="text-xs text-ink-dim hover:text-cyan">
          Forgot password?
        </Link>
      </div>

      <Button type="submit" size="lg" fullWidth loading={isLoading || authLoading}>
        {isLoading ? 'Signing in…' : 'Sign in'}
        <ArrowRight size={16} aria-hidden="true" />
      </Button>

      <div className="relative py-1 text-center">
        <span className="absolute inset-x-0 top-1/2 h-px bg-line" aria-hidden="true" />
        <span className="relative bg-panel px-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">or</span>
      </div>

      <Button type="button" variant="secondary" size="lg" fullWidth loading={demoLoading} onClick={handleDemo}>
        <Play size={14} aria-hidden="true" />
        Try the demo
      </Button>
      <p className="text-center font-mono text-[11px] text-ink-dim">Demo account holds SAMPLE DATA, not real study history.</p>

      <p className="pt-1 text-center text-sm text-ink-dim">
        Don&apos;t have an account?{' '}
        <Link href="/auth/signup" className={footerLink}>
          Sign up
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeNextPath(searchParams.get('callbackUrl'), typeof window === 'undefined' ? '' : window.location.origin);
  const { signUp, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);
    const { error } = await signUp(email, password);
    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }
    router.push(`/auth/verify?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Header title="Create account" subtitle="Start forecasting your memory today" />
      {error && <Message kind="error">{error}</Message>}

      <AuthField icon={Mail} type="email" label="Email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" />
      <AuthField
        icon={Lock}
        type="password"
        label="Password"
        value={password}
        onChange={setPassword}
        placeholder="At least 8 characters"
        autoComplete="new-password"
        showToggle
        showPassword={showPassword}
        onToggleShowPassword={() => setShowPassword(v => !v)}
      />
      <AuthField
        icon={Lock}
        type="password"
        label="Confirm password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        placeholder="Repeat password"
        autoComplete="new-password"
        showToggle
        showPassword={showPassword}
        onToggleShowPassword={() => setShowPassword(v => !v)}
      />

      <Button type="submit" size="lg" fullWidth loading={isLoading || authLoading}>
        {isLoading ? 'Creating account…' : 'Create account'}
        <ArrowRight size={16} aria-hidden="true" />
      </Button>

      <p className="text-center text-sm text-ink-dim">
        Already have an account?{' '}
        <Link href="/auth/signin" className={footerLink}>
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const { resetPassword, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const { error } = await resetPassword(email);
    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }
    setSuccess(true);
    setIsLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Header title="Reset password" subtitle="Enter your email to receive a password reset link" />
      {error && <Message kind="error">{error}</Message>}
      {success && <Message kind="success">Check your email for a reset link</Message>}

      {!success && (
        <>
          <AuthField icon={Mail} type="email" label="Email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" />
          <Button type="submit" size="lg" fullWidth loading={isLoading || authLoading}>
            {isLoading ? 'Sending…' : 'Send reset link'}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </>
      )}

      <p className="text-center text-sm">
        <Link href="/auth/signin" className={footerLink}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
