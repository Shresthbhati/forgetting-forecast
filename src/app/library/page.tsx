'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { generateForecast } from '@/domain/forecasting/engine';
import type { Concept, RecallState } from '@/types';
import {
  Button,
  Dialog,
  EmptyState,
  Input,
  ProgressRing,
  Select,
  Skeleton,
  StatusPill,
  TerminalPanel,
  Textarea,
  pillFromForecast,
  useToast,
} from '@/components/ui';

type ApiConcept = Concept & { recallState: RecallState | null };

const DIFFICULTY_OPTIONS = [
  { value: '1', label: '1 — very easy' },
  { value: '2', label: '2 — easy' },
  { value: '3', label: '3 — medium' },
  { value: '4', label: '4 — hard' },
  { value: '5', label: '5 — very hard' },
];

const EMPTY_FORM = { subject: '', prompt: '', answer: '', explanation: '', difficulty: '3' };

function agoLabel(iso: string | null): string {
  if (!iso) return 'never reviewed';
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return 'reviewed just now';
  if (hours < 48) return `reviewed ${Math.round(hours)}h ago`;
  return `reviewed ${Math.round(hours / 24)}d ago`;
}

function LibraryContent() {
  const searchParams = useSearchParams();
  const toast = useToast();

  const [concepts, setConcepts] = useState<ApiConcept[] | null>(null);
  const [target, setTarget] = useState(0.8);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [subject, setSubject] = useState('');

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<ApiConcept | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.concepts.list({ page: 1, pageSize: 100 });
      setConcepts(res.concepts as ApiConcept[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your concepts');
    }
  }, []);

  useEffect(() => {
    load();
    api.me.get().then(me => setTarget(me.targetRecall)).catch(() => undefined);
  }, [load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (concepts ?? [])
      .filter(c => !subject || c.subject === subject)
      .filter(c => !q || c.prompt.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q) || (c.topic ?? '').toLowerCase().includes(q))
      .map(c => {
        const f = c.recallState ? generateForecast({ concept: c, recallState: c.recallState, at: new Date(), targetRecall: target }) : null;
        return { concept: c, forecast: f };
      })
      .sort((a, b) => (a.forecast?.probability ?? 1) - (b.forecast?.probability ?? 1));
  }, [concepts, search, subject, target]);

  const subjects = useMemo(() => [...new Set((concepts ?? []).map(c => c.subject))].sort(), [concepts]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.subject.trim()) next.subject = 'Subject is required';
    if (!form.prompt.trim()) next.prompt = 'Write the question you want to be asked';
    if (!form.answer.trim()) next.answer = 'Write the expected answer';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function addConcept(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      await api.concepts.create({
        subject: form.subject.trim(),
        prompt: form.prompt.trim(),
        answer: form.answer.trim(),
        explanation: form.explanation.trim() || undefined,
        difficulty: Number(form.difficulty),
      });
      toast('Concept added. Your first forecast appears after a review.', { variant: 'success' });
      setAdding(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the concept', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.concepts.delete(deleting.id);
      setConcepts(prev => (prev ?? []).filter(c => c.id !== deleting.id));
      toast('Concept deleted', { variant: 'success' });
      setDeleting(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the concept', { variant: 'error' });
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">// KNOWLEDGE CARTRIDGES</p>
          <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.06em] text-chrome">Library</h1>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add concept
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <label htmlFor="library-search" className="sr-only">Search concepts</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
          <input
            id="library-search"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search prompts and subjects"
            className="w-full rounded-md border border-line bg-night py-2 pl-9 pr-3 text-sm text-ink placeholder:text-neutral-400 focus:border-cyan focus:outline-none focus:shadow-[var(--glow-cyan)]"
          />
        </div>
        <div role="group" aria-label="Filter by subject" className="flex flex-wrap gap-2">
          {['', ...subjects].map(s => (
            <button
              key={s || 'all'}
              type="button"
              aria-pressed={subject === s}
              onClick={() => setSubject(s)}
              className={cn(
                'rounded border px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors',
                subject === s ? 'border-magenta bg-magenta/15 text-magenta' : 'border-line text-ink-dim hover:text-ink'
              )}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <TerminalPanel title="SIGNAL_LOST.EXE">
          <div role="alert" className="space-y-3 py-4 text-center">
            <p className="text-sm text-ink-dim">{error}</p>
            <Button onClick={load}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>
          </div>
        </TerminalPanel>
      ) : concepts === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : rows.length === 0 ? (
        <TerminalPanel title="EMPTY.EXE">
          <EmptyState
            title={concepts.length === 0 ? 'No concepts yet' : 'No matches'}
            body={concepts.length === 0 ? 'Add the first thing you want to remember.' : 'Try a different search or subject.'}
            action={concepts.length === 0 ? <Button onClick={() => setAdding(true)}>Add your first concept</Button> : undefined}
          />
        </TerminalPanel>
      ) : (
        <>
          <p className="font-mono text-xs text-ink-dim">{rows.length} of {concepts.length} concepts · weakest first</p>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map(({ concept: c, forecast: f }) => (
              <li key={c.id} className="group relative">
                <Link
                  href={`/concepts/${c.id}`}
                  className="flex h-full gap-4 rounded-lg border border-line bg-panel/85 p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] backdrop-blur-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-magenta/60 hover:shadow-[var(--glow-magenta)]"
                >
                  <ProgressRing value={f?.probability ?? null} size={56} label="Estimated recall" />
                  <div className="min-w-0 flex-1 space-y-2 pr-6">
                    <span className="inline-block rounded border border-line bg-panel-hi px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
                      {c.subject}
                    </span>
                    <p className="line-clamp-2 text-sm font-medium text-ink">{c.prompt}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <StatusPill status={pillFromForecast(f?.status)} />
                      <span className="font-mono text-[11px] text-ink-dim">{agoLabel(c.recallState?.lastReviewedAt ?? null)}</span>
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  aria-label={`Delete concept: ${c.prompt.slice(0, 40)}`}
                  onClick={() => setDeleting(c)}
                  className="absolute right-2 top-2 rounded p-1.5 text-neutral-400 opacity-0 transition-opacity hover:text-due focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Add concept */}
      <Dialog open={adding} onClose={() => !saving && setAdding(false)} title="NEW_CONCEPT.EXE">
        <form onSubmit={addConcept} className="space-y-4" noValidate>
          <Input label="Subject" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Databases" error={errors.subject} maxLength={100} />
          <Textarea label="Prompt (the question)" value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} placeholder="What will you be asked?" error={errors.prompt} rows={3} />
          <Textarea label="Expected answer" value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} placeholder="What a correct answer says" error={errors.answer} rows={3} />
          <Textarea label="Explanation (optional)" value={form.explanation} onChange={e => setForm({ ...form, explanation: e.target.value })} rows={2} />
          <Select label="Difficulty" value={form.difficulty} options={DIFFICULTY_OPTIONS} onChange={v => setForm({ ...form, difficulty: v })} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving}>Add concept</Button>
          </div>
        </form>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleting !== null}
        onClose={() => !deleteBusy && setDeleting(null)}
        title="CONFIRM_DELETE.EXE"
        description="This permanently deletes the concept, its review history and its forecasts. This cannot be undone."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleteBusy}>Delete</Button>
          </>
        }
      >
        <p className="rounded border border-line bg-night p-3 text-sm text-ink">{deleting?.prompt}</p>
      </Dialog>
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <LibraryContent />
    </Suspense>
  );
}
