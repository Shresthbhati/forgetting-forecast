'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, LogOut, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { DISPLAY_KEYS, applyDisplayPrefs, readPref, writePref } from '@/components/DisplayPrefs';
import type { Me } from '@/types';
import { Button, Dialog, Input, Skeleton, TerminalPanel, useToast } from '@/components/ui';

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p id={`${label}-l`} className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-dim">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${label}-l`}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full border transition-colors', checked ? 'border-magenta bg-magenta/30' : 'border-line bg-panel-hi')}
      >
        <span className={cn('absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all', checked ? 'left-[22px] bg-magenta shadow-[var(--glow-magenta)]' : 'left-0.5 bg-ink-dim')} style={{ height: 18, width: 18 }} />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const { user, signOut } = useAuth();

  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [dailyGoal, setDailyGoal] = useState(20);
  const [targetRecall, setTargetRecall] = useState(80);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingStudy, setSavingStudy] = useState(false);

  const [scanlines, setScanlines] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const m = await api.me.get();
      setMe(m);
      setDisplayName(m.displayName ?? '');
      setTimezone(m.preferredTimezone);
      setDailyGoal(m.dailyGoal);
      setTargetRecall(Math.round(m.targetRecall * 100));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your settings');
    }
  }, []);

  useEffect(() => {
    load();
    setScanlines(readPref(DISPLAY_KEYS.scanlines) !== 'off');
    setReduceMotion(readPref(DISPLAY_KEYS.reduceMotion) === 'on');
  }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const m = await api.me.update({ displayName: displayName.trim() || null, preferredTimezone: timezone.trim() || 'UTC' });
      setMe(m);
      toast('Profile saved', { variant: 'success' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save your profile', { variant: 'error' });
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveStudy(e: React.FormEvent) {
    e.preventDefault();
    setSavingStudy(true);
    try {
      const m = await api.me.update({ dailyGoal, targetRecall: targetRecall / 100 });
      setMe(m);
      toast('Study preferences saved', { variant: 'success' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save your preferences', { variant: 'error' });
    } finally {
      setSavingStudy(false);
    }
  }

  function setDisplay(key: keyof typeof DISPLAY_KEYS, value: boolean) {
    if (key === 'scanlines') {
      setScanlines(value);
      writePref(DISPLAY_KEYS.scanlines, value ? 'on' : 'off');
    } else {
      setReduceMotion(value);
      writePref(DISPLAY_KEYS.reduceMotion, value ? 'on' : 'off');
    }
    applyDisplayPrefs();
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) return toast('Password must be at least 8 characters', { variant: 'error' });
    if (newPassword !== confirmPassword) return toast('Passwords do not match', { variant: 'error' });
    setSavingPassword(true);
    try {
      const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setNewPassword('');
      setConfirmPassword('');
      toast('Password updated', { variant: 'success' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update your password', { variant: 'error' });
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    window.location.assign('/welcome');
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    try {
      await api.me.delete();
      toast('Account deleted', { variant: 'success' });
      await signOut().catch(() => {});
      window.location.assign('/welcome');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete your account', { variant: 'error' });
      setDeleteBusy(false);
    }
  }

  if (error) {
    return (
      <TerminalPanel title="SIGNAL_LOST.EXE" className="mx-auto max-w-xl">
        <div role="alert" className="space-y-3 py-4 text-center">
          <p className="text-sm text-ink-dim">{error}</p>
          <Button onClick={load}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>
        </div>
      </TerminalPanel>
    );
  }

  if (!me) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading settings">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">// CONTROL PANEL</p>
        <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.06em] text-chrome">Settings</h1>
      </div>

      <TerminalPanel title="PROFILE.CFG">
        <form onSubmit={saveProfile} className="space-y-4">
          <Input label="Email" value={me.email ?? user?.email ?? ''} readOnly disabled helperText="Your sign-in email can't be changed here." />
          <Input label="Display name" value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={100} placeholder="How should we greet you?" />
          <Input label="Time zone" value={timezone} onChange={e => setTimezone(e.target.value)} maxLength={64} placeholder="e.g. Asia/Kolkata" />
          <div className="flex justify-end"><Button type="submit" loading={savingProfile}>Save profile</Button></div>
        </form>
      </TerminalPanel>

      <TerminalPanel title="STUDY_PREFS.CFG">
        <form onSubmit={saveStudy} className="space-y-4">
          <Input label="Daily goal (reviews)" type="number" min={1} max={500} value={dailyGoal} onChange={e => setDailyGoal(Number(e.target.value))} />
          <div>
            <label htmlFor="target" className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Target recall
              <output htmlFor="target" className="font-mono text-sm text-cyan">{targetRecall}%</output>
            </label>
            <input id="target" type="range" min={50} max={99} value={targetRecall} onChange={e => setTargetRecall(Number(e.target.value))} className="h-2 w-full cursor-pointer accent-magenta" />
            <p className="mt-1.5 text-xs text-ink-dim">Saved to your profile. The scheduler times each next review for the moment predicted recall falls to this value (applied from your next review of each concept), and “Review soon” / “Strong” labels use it too. Higher means more frequent reviews.</p>
          </div>
          <div className="flex justify-end"><Button type="submit" loading={savingStudy}>Save preferences</Button></div>
        </form>
      </TerminalPanel>

      <TerminalPanel title="DISPLAY.CFG">
        <div className="divide-y divide-line/60">
          <Toggle label="CRT scanlines" description="A faint horizontal line texture over the whole screen." checked={scanlines} onChange={v => setDisplay('scanlines', v)} />
          <Toggle label="Reduce motion" description="Stops the moving grid, the curve draw-in and shimmer effects. Your system setting is always respected too." checked={reduceMotion} onChange={v => setDisplay('reduceMotion', v)} />
        </div>
        <p className="mt-3 font-mono text-[11px] text-ink-dim">Saved on this device only.</p>
      </TerminalPanel>

      {!me.isDemo && (
        <TerminalPanel title="SECURITY.CFG">
          <form onSubmit={changePassword} className="space-y-4">
            <Input label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} helperText="At least 8 characters" />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            <div className="flex justify-end"><Button type="submit" loading={savingPassword}>Update password</Button></div>
          </form>
        </TerminalPanel>
      )}

      <TerminalPanel title="DATA.CFG">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Export your data</p>
              <p className="text-xs text-ink-dim">Concepts, recall states, attempts, sessions and the forecast log as one JSON file.</p>
            </div>
            <a href={api.me.exportUrl} download>
              <Button variant="secondary"><Download className="h-4 w-4" aria-hidden="true" />Export JSON</Button>
            </a>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <div>
              <p className="text-sm font-medium text-due">Delete account</p>
              <p className="text-xs text-ink-dim">
                {me.isDemo ? 'The shared demo account cannot be deleted.' : 'Permanently deletes your account and every concept, review and forecast.'}
              </p>
            </div>
            <Button variant="danger" onClick={() => { setDeleteText(''); setDeleting(true); }} disabled={me.isDemo}>Delete account</Button>
          </div>
        </div>
      </TerminalPanel>

      <div className="flex justify-end">
        <Button variant="secondary" onClick={handleSignOut}><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</Button>
      </div>

      <Dialog
        open={deleting}
        onClose={() => !deleteBusy && setDeleting(false)}
        title="DELETE_ACCOUNT.EXE"
        description="This cannot be undone. Type DELETE to confirm."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)} disabled={deleteBusy}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleteBusy} disabled={deleteText !== 'DELETE'}>Delete everything</Button>
          </>
        }
      >
        <Input label="Confirmation" value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder="DELETE" autoComplete="off" />
      </Dialog>
    </div>
  );
}
