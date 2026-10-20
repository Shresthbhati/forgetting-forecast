'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Eye, EyeOff, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { calculateRecallProbability } from '@/domain/forecasting/engine';
import type { ConceptDetail, ForecastLogEntry } from '@/types';
import {
  Button,
  Dialog,
  Input,
  Select,
  Skeleton,
  StatusPill,
  TerminalPanel,
  Textarea,
  pillFromForecast,
  useToast,
} from '@/components/ui';
import { ForecastCurve } from '@/components/charts';
import { PrerequisitePanel } from '@/components/PrerequisitePanel';

const DIFFICULTY_OPTIONS = [1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n} — ${['very easy', 'easy', 'medium', 'hard', 'very hard'][n - 1]}` }));

const pct = (p: number) => `${Math.round(p * 100)}%`;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function hoursLabel(h: number | null): string {
  if (h === null) return '—';
  if (h < 1) return 'under an hour';
  if (h < 48) return `${Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 last:border-0">
      <dt className="text-sm text-ink-dim">
        {label}
        {hint && <span className="block font-mono text-[10px] text-neutral-400">{hint}</span>}
      </dt>
      <dd className="text-right font-mono text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

const logTag: Record<ForecastLogEntry['status'], string> = {
  pending: 'border-line text-ink-dim',
  evaluated: 'border-strong/50 bg-strong/10 text-strong',
  expired: 'border-neutral-400/40 text-neutral-400',
};

export default function ConceptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const [log, setLog] = useState<ForecastLogEntry[] | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showAllLog, setShowAllLog] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ subject: '', prompt: '', answer: '', explanation: '', difficulty: '3' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, l] = await Promise.all([api.concepts.detail(id), api.forecasts.log(id).catch(() => null)]);
      setDetail(d);
      setLog(l ? l.forecasts : null);
      setNow(Date.now());
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : 'Failed to load this concept',
        notFound: err instanceof ApiRequestError && err.status === 404,
      });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const predict = useMemo(
    () => (detail ? (at: Date) => calculateRecallProbability(detail.concept, detail.recallState, at) : null),
    [detail]
  );

  function openEdit() {
    if (!detail) return;
    const c = detail.concept;
    setForm({ subject: c.subject, prompt: c.prompt, answer: c.answer, explanation: c.explanation ?? '', difficulty: String(c.difficulty) });
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim() || !form.prompt.trim() || !form.answer.trim()) {
      toast('Subject, prompt and answer are required', { variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      await api.concepts.update(id, {
        subject: form.subject.trim(),
        prompt: form.prompt.trim(),
        answer: form.answer.trim(),
        explanation: form.explanation.trim() || null,
        difficulty: Number(form.difficulty),
      });
      toast('Concept updated', { variant: 'success' });
      setEditing(false);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the concept', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    try {
      await api.concepts.delete(id);
      toast('Concept deleted', { variant: 'success' });
      router.push('/library');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the concept', { variant: 'error' });
      setDeleteBusy(false);
    }
  }

  if (error) {
    return (
      <TerminalPanel title={error.notFound ? 'NOT_FOUND.EXE' : 'SIGNAL_LOST.EXE'} className="mx-auto max-w-xl">
        <div role="alert" className="space-y-3 py-4 text-center">
          <h1 className="font-display text-xl font-bold uppercase tracking-[0.1em] text-due">{error.notFound ? 'Concept not found' : 'Signal lost'}</h1>
          <p className="text-sm text-ink-dim">{error.notFound ? 'It may have been deleted, or it belongs to another account.' : error.message}</p>
          <div className="flex justify-center gap-3">
            {!error.notFound && <Button onClick={load}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>}
            <Link href="/library"><Button variant="secondary">Back to library</Button></Link>
          </div>
        </div>
      </TerminalPanel>
    );
  }

  if (!detail || !predict) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading concept">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const { concept, recallState, forecast, priority, attempts, horizonForecasts } = detail;
  const f = priority.factors;
  const visibleLog = showAllLog ? log ?? [] : (log ?? []).slice(0, 9);

  return (
    <div className="space-y-6">
      <Link href="/library" className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-ink-dim hover:text-cyan">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Library
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-line bg-panel-hi px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-dim">{concept.subject}</span>
            <span className="font-mono text-[11px] text-ink-dim">DIFFICULTY {concept.difficulty}/5</span>
            <StatusPill status={pillFromForecast(forecast.status)} />
          </div>
          <h1 className="font-display text-xl font-bold leading-snug tracking-[0.02em] text-ink sm:text-2xl">{concept.prompt}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/review?concept=${concept.id}`}>
            <Button><Play className="h-4 w-4" aria-hidden="true" />Review this now</Button>
          </Link>
          <Button variant="secondary" onClick={openEdit} aria-label="Edit concept"><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>
          <Button variant="danger" onClick={() => setDeleting(true)} aria-label="Delete concept"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <TerminalPanel title="FORECAST_CURVE.EXE" className="lg:col-span-2">
          <ForecastCurve
            predict={predict}
            lastReviewedAt={recallState.lastReviewedAt ? new Date(recallState.lastReviewedAt).getTime() : null}
            attempts={[...attempts].reverse().map(a => ({ at: new Date(a.answeredAt).getTime(), predicted: a.predictedRecallProbability, correct: a.actualCorrectness }))}
            now={now}
            targetRecall={detail.targetRecall ?? 0.8}
            title={concept.prompt.slice(0, 60)}
          />
          <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-center">
            {horizonForecasts.map(h => (
              <div key={h.horizonHours}>
                <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-dim">in {h.horizonHours / 24}d · ESTIMATE</dt>
                <dd className="mt-1 font-display text-xl font-bold tabular-nums text-ink">{pct(h.forecast.probability)}</dd>
              </div>
            ))}
          </dl>
        </TerminalPanel>

        <TerminalPanel title="WHY_PRIORITIZED.EXE">
          <p className="mb-2 text-xs text-ink-dim">Exactly what the scheduler used. Nothing here is invented.</p>
          <dl>
            <Row label="Estimated recall now" value={pct(f.estimatedRecallProbability)} hint="ESTIMATE" />
            <Row label="Since last review" value={hoursLabel(f.hoursSinceLastReview)} />
            <Row label="Overdue" value={f.isOverdue ? 'yes' : 'no'} />
            <Row label="Uncertainty" value={f.uncertaintyLevel} hint="fewer reviews = higher" />
            <Row label="Priority score" value={priority.priorityScore.toFixed(2)} />
            <Row label="Next review" value={priority.nextReviewAt ? when(priority.nextReviewAt) : '—'} />
            <Row label="Half-life estimate" value={hoursLabel(recallState.estimatedHalfLifeHours)} />
            <Row label="Reviews" value={`${recallState.repetitionCount} (${recallState.successfulRecallCount} ✓ · ${recallState.lapseCount} ✗)`} hint="OBSERVED" />
          </dl>
        </TerminalPanel>
      </div>

      <TerminalPanel
        title="ANSWER.EXE"
        actions={
          <button type="button" onClick={() => setShowAnswer(v => !v)} aria-pressed={showAnswer} className="flex items-center gap-1.5 font-mono text-[11px] text-ink-dim hover:text-cyan">
            {showAnswer ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            {showAnswer ? 'Hide' : 'Reveal'}
          </button>
        }
      >
        {showAnswer ? (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap text-sm font-medium text-ink">{concept.answer}</p>
            {concept.explanation && <p className="text-sm text-ink-dim">{concept.explanation}</p>}
          </div>
        ) : (
          <p className="font-mono text-xs text-ink-dim">Hidden so you can test yourself first.</p>
        )}
      </TerminalPanel>

      {concept.sourceReference && (
        <p className="font-mono text-xs text-ink-dim">
          From:{' '}
          {concept.sourceId ? (
            <Link href={`/sources/${concept.sourceId}`} className="text-cyan underline-offset-2 hover:underline">{concept.sourceReference}</Link>
          ) : (
            concept.sourceReference
          )}

      {concept.sourceId && <PrerequisitePanel conceptId={concept.id} />}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <TerminalPanel title="ATTEMPTS.LOG" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-strong">OBSERVED</span>} padded={false}>
          {attempts.length === 0 ? (
            <p className="p-5 text-center font-mono text-xs text-ink-dim">No reviews yet. Review this concept to start its history.</p>
          ) : (
            <ol className="max-h-96 divide-y divide-line/60 overflow-y-auto">
              {attempts.map(a => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span aria-label={a.actualCorrectness ? 'Correct' : 'Missed'} className={cn('w-5 text-center font-mono text-sm font-bold', a.actualCorrectness ? 'text-strong' : 'text-due')}>
                    {a.actualCorrectness ? '✓' : '✗'}
                  </span>
                  <span className="flex-1 font-mono text-xs text-ink">{when(a.answeredAt)}</span>
                  <span className="font-mono text-[11px] text-ink-dim">
                    predicted {pct(a.predictedRecallProbability)}
                    {a.selfReportedConfidence !== null && ` · conf ${Math.round(a.selfReportedConfidence * 5)}/5`}
                    {` · ${(a.responseLatencyMs / 1000).toFixed(1)}s`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </TerminalPanel>

        <TerminalPanel title="FORECAST_LOG.DAT" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-cyan">ESTIMATE · IMMUTABLE</span>} padded={false}>
          {log === null ? (
            <p className="p-5 text-center font-mono text-xs text-ink-dim">The forecast log could not be loaded.</p>
          ) : log.length === 0 ? (
            <p className="p-5 text-center font-mono text-xs text-ink-dim">Forecasts are logged after each review, then checked against what actually happens.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <caption className="sr-only">Logged forecasts and their evaluations</caption>
                  <thead className="text-[10px] uppercase tracking-wider text-ink-dim">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-semibold">Made</th>
                      <th scope="col" className="px-2 py-2 font-semibold">For</th>
                      <th scope="col" className="px-2 py-2 font-semibold">Predicted</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {visibleLog.map(entry => (
                      <tr key={entry.id}>
                        <td className="px-4 py-2 text-ink-dim">{when(entry.generatedAt)}</td>
                        <td className="px-2 py-2 text-ink">{entry.horizonHours / 24}d</td>
                        <td className="px-2 py-2 text-ink">{pct(entry.predictedProbability)}</td>
                        <td className="px-4 py-2">
                          <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', logTag[entry.status])}>{entry.status}</span>
                          {entry.evaluation && (
                            <span className="ml-2 text-ink-dim">
                              {entry.evaluation.observedCorrect ? '✓' : '✗'} err {entry.evaluation.absError.toFixed(2)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {log.length > 9 && (
                <button type="button" onClick={() => setShowAllLog(v => !v)} className="w-full border-t border-line py-2 font-mono text-[11px] text-ink-dim hover:text-cyan">
                  {showAllLog ? 'Show fewer' : `Show all ${log.length}`}
                </button>
              )}
            </>
          )}
        </TerminalPanel>
      </div>

      <Dialog open={editing} onClose={() => !saving && setEditing(false)} title="EDIT_CONCEPT.EXE">
        <form onSubmit={saveEdit} className="space-y-4" noValidate>
          <Input label="Subject" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} maxLength={100} />
          <Textarea label="Prompt" value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} rows={3} />
          <Textarea label="Expected answer" value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} rows={3} />
          <Textarea label="Explanation (optional)" value={form.explanation} onChange={e => setForm({ ...form, explanation: e.target.value })} rows={2} />
          <Select label="Difficulty" value={form.difficulty} options={DIFFICULTY_OPTIONS} onChange={v => setForm({ ...form, difficulty: v })} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving}>Save changes</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleting}
        onClose={() => !deleteBusy && setDeleting(false)}
        title="CONFIRM_DELETE.EXE"
        description="This permanently deletes the concept, its review history and its forecasts. This cannot be undone."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)} disabled={deleteBusy}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleteBusy}>Delete</Button>
          </>
        }
      >
        <p className="rounded border border-line bg-night p-3 text-sm text-ink">{concept.prompt}</p>
      </Dialog>
    </div>
  );
}
