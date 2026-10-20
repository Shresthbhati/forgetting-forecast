'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Check, ListChecks, Plus, RotateCcw } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatLocation } from '@/domain/ingestion/location';
import type { SourceDetail, SourceMastery, SourceSection, SourceTerm } from '@/types';
import { MIN_MASTERY_ATTEMPTS } from '@/domain/assessment/mastery';
import { Badge, Button, Dialog, EmptyState, Skeleton, StatusPill, TerminalPanel, Textarea, useToast } from '@/components/ui';

type Tab = 'reader' | 'terms' | 'mastery';

function termsLabel(count: number) {
  return `${count} key term${count === 1 ? '' : 's'}`;
}

export default function SourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();

  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>('reader');
  const [activeOrdinal, setActiveOrdinal] = useState(0);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'defined'>('all');
  const [mastery, setMastery] = useState<SourceMastery | null>(null);
  const [masteryError, setMasteryError] = useState('');

  const [passage, setPassage] = useState<SourceSection | null>(null);
  const [form, setForm] = useState({ prompt: '', answer: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.sources.get(id);
      setDetail(d);
      setAdded(new Set(d.addedTermIds));
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : 'Failed to load this source',
        notFound: err instanceof ApiRequestError && err.status === 404,
      });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Mastery is computed from real attempts, so it is read when the tab is opened (a quiz may have just changed it).
  useEffect(() => {
    if (tab !== 'mastery') return;
    let cancelled = false;
    setMasteryError('');
    api.sources.mastery(id).then(m => !cancelled && setMastery(m)).catch(err => !cancelled && setMasteryError(err instanceof Error ? err.message : 'Could not load mastery'));
    return () => {
      cancelled = true;
    };
  }, [tab, id]);

  const sectionById = useMemo(() => new Map((detail?.sections ?? []).map(s => [s.id, s])), [detail]);
  const visibleTerms = useMemo(
    () => (detail?.terms ?? []).filter(t => filter === 'all' || t.definition !== null),
    [detail, filter]
  );
  const addable = visibleTerms.filter(t => !added.has(t.id));
  const active = detail?.sections.find(s => s.ordinal === activeOrdinal) ?? detail?.sections[0];

  async function addTerms(terms: SourceTerm[]) {
    if (terms.length === 0) return;
    const ids = terms.map(t => t.id);
    setPending(prev => new Set([...prev, ...ids]));
    try {
      const { created, skipped } = await api.sources.createConcepts(id, { items: ids.map(termId => ({ type: 'term' as const, termId })) });
      const failedIds = new Set(skipped.filter(s => s.reason !== 'Already added').map(s => s.termId));
      setAdded(prev => new Set([...prev, ...ids.filter(t => !failedIds.has(t))]));
      if (created.length > 0) {
        toast(`${created.length} concept${created.length === 1 ? '' : 's'} added. First forecast appears after a review.`, { variant: 'success' });
      }
      if (failedIds.size > 0) {
        const reason = skipped.find(s => s.reason !== 'Already added')?.reason ?? 'Could not add';
        toast(`${failedIds.size} not added: ${reason}`, { variant: 'info', duration: 7000 });
      } else if (created.length === 0) {
        toast('Those terms were already added', { variant: 'info' });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add concepts', { variant: 'error' });
    } finally {
      setPending(prev => {
        const next = new Set(prev);
        ids.forEach(t => next.delete(t));
        return next;
      });
    }
  }

  function openPassage(section: SourceSection) {
    setPassage(section);
    setForm({ prompt: '', answer: section.text.slice(0, 600).trim() });
    setFormErrors({});
  }

  async function savePassage(e: React.FormEvent) {
    e.preventDefault();
    if (!passage) return;
    const next: Record<string, string> = {};
    if (!form.prompt.trim()) next.prompt = 'Write the question you want to be asked';
    if (!form.answer.trim()) next.answer = 'Write the expected answer';
    setFormErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const { created, skipped } = await api.sources.createConcepts(id, {
        items: [{ type: 'passage', sectionId: passage.id, prompt: form.prompt.trim(), answer: form.answer.trim() }],
      });
      if (created.length) {
        toast('Concept added with a link to this passage.', { variant: 'success' });
        setPassage(null);
      } else {
        toast(skipped[0]?.reason ?? 'Nothing was added', { variant: 'info' });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the concept', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/sources" className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-ink-dim hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Sources
        </Link>
        <TerminalPanel title={error.notFound ? 'NOT_FOUND.EXE' : 'SIGNAL_LOST.EXE'}>
          <div role="alert" className="space-y-3 py-4 text-center">
            <p className="text-sm text-ink-dim">{error.notFound ? 'This source does not exist or was deleted.' : error.message}</p>
            {!error.notFound && <Button onClick={load}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>}
          </div>
        </TerminalPanel>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const { source } = detail;
  const unit = source.kind === 'pptx' ? 'slide' : 'page';

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/sources" className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-ink-dim hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Sources
        </Link>
        <h1 className="break-words font-display text-2xl font-black uppercase tracking-[0.04em] text-chrome sm:text-3xl">{source.title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusPill status="strong" label="READY" />
          <Badge size="sm">{source.subject}</Badge>
          <span className="font-mono text-[11px] text-ink-dim">
            {source.kind === 'pdf' || source.kind === 'pptx' ? `${source.unitCount ?? 0} ${unit}${source.unitCount === 1 ? '' : 's'} · ` : ''}
            {detail.sections.length} sections · {termsLabel(detail.terms.length)}
          </span>
        </div>
        <p className="font-mono text-[11px] text-ink-dim">
          Terms and definitions are picked out by rules, not by a model. Check them against the text before you rely on them.
        </p>
      </div>

      <div role="tablist" aria-label="Source views" className="flex gap-2">
        {([['reader', 'Outline & reader'], ['terms', `Key terms (${detail.terms.length})`], ['mastery', 'Mastery']] as const).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'min-h-11 rounded border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors sm:min-h-0',
              tab === key ? 'border-magenta bg-magenta/15 text-magenta' : 'border-line text-ink-dim hover:text-ink'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'reader' && (
        <div id="panel-reader" role="tabpanel" aria-labelledby="tab-reader" className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <nav aria-label="Outline" className="max-h-64 overflow-y-auto rounded-lg border border-line bg-panel/85 p-2 lg:max-h-[70vh]">
            <ul className="space-y-0.5">
              {detail.sections.map(s => {
                const loc = formatLocation(s.location);
                const isActive = active?.ordinal === s.ordinal;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => setActiveOrdinal(s.ordinal)}
                      style={{ paddingLeft: `${0.5 + (Math.min(s.level, 4) - 1) * 0.75}rem` }}
                      className={cn(
                        'flex w-full items-baseline justify-between gap-2 rounded py-1.5 pr-2 text-left text-sm transition-colors',
                        isActive ? 'bg-magenta/15 text-ink' : 'text-ink-dim hover:bg-panel-hi hover:text-ink'
                      )}
                    >
                      <span className="min-w-0 break-words">{s.heading}</span>
                      {loc && <span className="shrink-0 font-mono text-[10px] uppercase text-ink-dim">{loc}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {active && (
            <article className="min-w-0 space-y-4 rounded-lg border border-line bg-panel/85 p-4 sm:p-6">
              <header className="space-y-1">
                <p className="font-mono text-[11px] uppercase tracking-wider text-ink-dim">{formatLocation(active.location) || 'Document'}</p>
                <h2 className="break-words font-display text-xl font-bold text-ink">{active.heading}</h2>
              </header>
              <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ink">{active.text}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => openPassage(active)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />Make a concept from this passage
                </Button>
                <Link
                  href={`/sources/${id}/quiz?section=${active.id}`}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-sunset px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-void shadow-[inset_0_1px_0_rgb(255_255_255/0.65)] sm:min-h-0"
                >
                  <ListChecks className="h-4 w-4" aria-hidden="true" />Quiz this section
                </Link>
              </div>
            </article>
          )}
        </div>
      )}

      {tab === 'terms' && (
        <div id="panel-terms" role="tabpanel" aria-labelledby="tab-terms" className="space-y-4">
          {detail.terms.length === 0 ? (
            <TerminalPanel title="EMPTY.EXE">
              <EmptyState title="No key terms found" body="The text had no repeated phrases or definitions the rules could pick out. You can still make a concept from any passage in the reader." />
            </TerminalPanel>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="group" aria-label="Filter terms" className="flex gap-2">
                  {([['all', 'All terms'], ['defined', 'With definitions']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={filter === key}
                      onClick={() => setFilter(key)}
                      className={cn(
                        'min-h-11 rounded border px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors sm:min-h-0',
                        filter === key ? 'border-magenta bg-magenta/15 text-magenta' : 'border-line text-ink-dim hover:text-ink'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button size="sm" className="min-h-11 sm:min-h-0" onClick={() => addTerms(addable)} disabled={addable.length === 0 || addable.some(t => pending.has(t.id))}>
                  <Plus className="h-4 w-4" aria-hidden="true" />Add all ({addable.length})
                </Button>
              </div>

              <ul className="space-y-3">
                {visibleTerms.map(t => {
                  const isAdded = added.has(t.id);
                  const section = t.sectionId ? sectionById.get(t.sectionId) : undefined;
                  const loc = formatLocation(t.location);
                  return (
                    <li key={t.id} className="flex flex-col gap-3 rounded-lg border border-line bg-panel/85 p-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="break-words text-sm font-semibold text-ink">{t.term}</p>
                        {t.definition ? (
                          <p className="break-words text-sm text-ink-dim">{t.definition}</p>
                        ) : (
                          <p className="text-sm italic text-ink-dim">No definition detected — added with the first sentence that mentions it.</p>
                        )}
                        <p className="font-mono text-[11px] text-ink-dim">
                          {[section?.heading, loc].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {isAdded ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-strong">
                          <Check className="h-4 w-4" aria-hidden="true" />Added
                        </span>
                      ) : (
                        <Button size="sm" variant="secondary" className="min-h-11 shrink-0 sm:min-h-0" loading={pending.has(t.id)} onClick={() => addTerms([t])} aria-label={`Add ${t.term} as concept`}>
                          Add as concept
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'mastery' && (
        <div id="panel-mastery" role="tabpanel" aria-labelledby="tab-mastery" className="space-y-4">
          <p className="text-sm text-ink-dim">
            Per topic (section), from your real answers on concepts made from this source. Recent answers count more. A topic needs at least {MIN_MASTERY_ATTEMPTS} answers before a mastery figure is shown.
          </p>
          {masteryError ? (
            <TerminalPanel title="SIGNAL_LOST.EXE"><p role="alert" className="py-3 text-center text-sm text-ink-dim">{masteryError}</p></TerminalPanel>
          ) : !mastery ? (
            <Skeleton className="h-40 w-full" aria-busy="true" />
          ) : mastery.topics.length === 0 ? (
            <TerminalPanel title="EMPTY.EXE">
              <EmptyState title="No concepts from this source yet" body="Add some key terms as concepts, answer a section quiz, and mastery per topic will appear here." />
            </TerminalPanel>
          ) : (
            <ul className="space-y-3">
              {mastery.topics.map(t => (
                <li key={t.topic} className="space-y-2 rounded-lg border border-line bg-panel/85 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="min-w-0 break-words text-sm font-semibold text-ink">{t.topic}</p>
                    <p className="font-mono text-[11px] text-ink-dim">{t.concepts} concept{t.concepts === 1 ? '' : 's'} · {t.attempts} answer{t.attempts === 1 ? '' : 's'}</p>
                  </div>
                  {t.mastery === null ? (
                    <p className="text-xs text-ink-dim">Not enough data yet ({t.attempts} of {MIN_MASTERY_ATTEMPTS} answers).</p>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div role="meter" aria-label={`Mastery of ${t.topic}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t.mastery * 100)} className="h-2 flex-1 overflow-hidden rounded bg-panel-hi">
                        <div className={cn('h-full', t.mastery >= 0.8 ? 'bg-strong' : t.mastery >= 0.55 ? 'bg-watch' : 'bg-due')} style={{ width: `${t.mastery * 100}%` }} />
                      </div>
                      <span className="w-12 text-right font-mono text-sm text-ink">{Math.round(t.mastery * 100)}%</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog open={passage !== null} onClose={() => !saving && setPassage(null)} title="NEW_CONCEPT.EXE" description={passage ? `From “${passage.heading}”. The concept keeps a link back to this passage.` : undefined}>
        <form onSubmit={savePassage} className="space-y-4" noValidate>
          <Textarea label="Prompt (the question)" value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} placeholder="What will you be asked?" error={formErrors.prompt} rows={3} />
          <Textarea label="Expected answer" value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} error={formErrors.answer} rows={6} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setPassage(null)} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving}>Add concept</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
