'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Play, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { calculateRecallProbability } from '@/domain/forecasting/engine';
import type { Concept, ConceptDetail, RecallState } from '@/types';
import { Button, EmptyState, ProgressRing, Skeleton, StatTile, StatusPill, TerminalPanel, pillFromForecast } from '@/components/ui';
import { ForecastCurve, RetentionBars } from '@/components/charts';
import { MemoryMap } from '@/components/MemoryMap';

const DEFAULT_TARGET = 0.8;
const HOUR = 3_600_000;
const WEEK_HOURS = 168;

type QueueItem = {
  concept: Concept;
  recallState: RecallState;
  forecast: { probability: number; dueInHours: number; status: string; evidence: string };
  priorityScore: number;
  schedulingFactors?: { hoursSinceLastReview: number | null; isOverdue: boolean; uncertaintyLevel: string };
};

type Summary = Awaited<ReturnType<typeof api.dashboard>>;
type Analytics = Awaited<ReturnType<typeof api.analytics>>;

const title = (c: { prompt: string }) => (c.prompt.length > 58 ? `${c.prompt.slice(0, 58)}…` : c.prompt);
const pct = (p: number) => `${Math.round(p * 100)}%`;

function ageLabel(hours: number | null): string {
  if (hours === null) return 'never reviewed';
  if (hours < 1) return 'reviewed just now';
  if (hours < 48) return `last seen ${Math.round(hours)}h ago`;
  return `last seen ${Math.round(hours / 24)}d ago`;
}

/** One honest line explaining why a concept is in the queue, built only from values the API returned. */
function whyLine(item: QueueItem): string {
  const f = item.schedulingFactors;
  const half = item.recallState.estimatedHalfLifeHours;
  const halfLabel = half < 48 ? `${half.toFixed(half < 10 ? 1 : 0)}h half-life` : `${Math.round(half / 24)}d half-life`;
  return [f?.isOverdue ? 'overdue' : null, ageLabel(f?.hoursSinceLastReview ?? null), halfLabel].filter(Boolean).join(' · ');
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());
  // The user's target recall (Settings); the default only shows until it loads.
  const [target, setTarget] = useState<number>(DEFAULT_TARGET);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, q, a, me] = await Promise.all([
        api.dashboard(),
        api.reviewQueue({ mode: 'practice', maxItems: 100 }),
        api.analytics().catch(() => null), // a failing analytics call must not take the dashboard down
        api.me.get().catch(() => null),
      ]);
      if (me) setTarget(me.targetRecall);
      setSummary(s);
      setQueue(q.items as QueueItem[]);
      setAnalytics(a);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = queue ?? [];
  const probabilityAt = useCallback(
    (item: QueueItem, hoursAhead: number) =>
      calculateRecallProbability(item.concept, item.recallState, new Date(now + hoursAhead * HOUR)),
    [now]
  );

  // "Due" means the scheduled next review has passed: the same definition the sidebar badge and the API use.
  const dueCount = summary?.dueConcepts ?? 0;
  const fading = items.filter(i => i.forecast.status !== 'Strong');
  const atRisk7d = useMemo(() => items.filter(i => probabilityAt(i, WEEK_HOURS) < target), [items, probabilityAt, target]);
  const crossing = useMemo(
    () => items.filter(i => i.forecast.probability >= target && probabilityAt(i, WEEK_HOURS) < target),
    [items, probabilityAt, target]
  );

  // The most at-risk concepts are the curve's choices; default to the first.
  const candidates = items.slice(0, 5);
  useEffect(() => {
    if (!selectedId && candidates.length > 0) setSelectedId(candidates[0].concept.id);
  }, [candidates, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetailLoading(true);
    api.concepts
      .detail(selectedId)
      .then(d => !cancelled && setDetail(d))
      .catch(() => !cancelled && setDetail(null))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const medianMs = useMemo(() => {
    const pts = analytics?.timePerRetrieval ?? [];
    return pts.length ? pts.reduce((s: number, p: { medianMs: number }) => s + p.medianMs, 0) / pts.length : null;
  }, [analytics]);

  const predict = useMemo(
    () => (detail ? (at: Date) => calculateRecallProbability(detail.concept, detail.recallState, at) : null),
    [detail]
  );

  if (loading && !summary) return <DashboardSkeleton />;

  if (error) {
    return (
      <TerminalPanel title="SIGNAL_LOST.EXE" className="mx-auto max-w-xl">
        <div role="alert" className="space-y-3 py-4 text-center">
          <h2 className="font-display text-xl font-bold uppercase tracking-[0.1em] text-due">Signal lost</h2>
          <p className="text-sm text-ink-dim">{error}</p>
          <Button onClick={load}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      </TerminalPanel>
    );
  }

  if (!summary || items.length === 0) {
    return (
      <TerminalPanel title="WELCOME.EXE">
        <EmptyState
          title="No concepts yet"
          body="Add the first thing you want to remember. Forecasts appear after your first review."
          action={
            <Link href="/library">
              <Button>Add your first concept</Button>
            </Link>
          }
        />
      </TerminalPanel>
    );
  }

  const minutes = medianMs ? Math.max(1, Math.round((fading.length * medianMs) / 60_000)) : null;
  const nextDue = items
    .map(i => i.recallState.nextReviewAt)
    .filter((d): d is string => !!d)
    .sort()[0];

  const delayed = analytics?.immediateVsDelayed?.delayed;
  const brier = analytics?.calibration?.brierScore ?? null;

  return (
    <div className="space-y-6">
      {/* 1. Next action */}
      <section className="relative overflow-hidden rounded-lg border border-line bg-panel/85 p-6 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-sm sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-magenta/15 blur-3xl" />
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">{"// TODAY'S TRANSMISSION"}</p>
        {fading.length > 0 ? (
          <>
            <h1 className="mt-3 font-display text-2xl font-black uppercase tracking-[0.04em] text-ink sm:text-4xl">
              <span className="text-magenta text-glow-magenta">{fading.length}</span> concept{fading.length === 1 ? ' is' : 's are'} fading.
            </h1>
            <p className="mt-2 font-mono text-sm text-ink-dim">
              {dueCount > 0 ? `${dueCount} due now` : 'Review soon'}
              {minutes ? ` · about ${minutes} min at your usual pace (ESTIMATE)` : ''}
            </p>
            <Link href="/review" className="mt-6 inline-block">
              <Button size="lg">
                <Play className="h-4 w-4" aria-hidden="true" />
                Start review
              </Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-3 font-display text-2xl font-black uppercase tracking-[0.04em] text-strong sm:text-4xl">All signals strong.</h1>
            <p className="mt-2 font-mono text-sm text-ink-dim">
              {nextDue ? `Next review ${formatRelativeTime(nextDue)}.` : 'Nothing is due.'}
            </p>
            <Link href="/review" className="mt-6 inline-block">
              <Button size="lg" variant="secondary">Practice anyway</Button>
            </Link>
          </>
        )}
      </section>

      {/* 2. Stat tiles */}
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Due now" value={dueCount} glow={dueCount > 0 ? 'magenta' : 'none'} tag="estimate" foot={`of ${items.length} concepts`} />
        <StatTile label="At risk in 7d" value={atRisk7d.length} tag="estimate" foot="below 80% within a week" />
        <StatTile
          label="Delayed recall"
          value={delayed?.accuracy != null ? Math.round(delayed.accuracy * 100) : null}
          unit="%"
          glow="cyan"
          tag="observed"
          foot={`72h+ gaps · n = ${delayed?.n ?? 0}`}
          emptyHint={`needs ${10} delayed attempts (have ${delayed?.n ?? 0})`}
        />
        <StatTile
          label="Forecast calibration"
          value={brier !== null ? brier.toFixed(3) : null}
          tag="observed"
          foot={`Brier score · n = ${analytics?.calibration?.n ?? 0}`}
          emptyHint="needs more reviews"
        />
      </section>

      {/* 3. Curve + queue */}
      <section className="grid gap-6 lg:grid-cols-5">
        <TerminalPanel title="FORECAST_CURVE.EXE" className="lg:col-span-3">
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Choose a concept">
            {candidates.map(c => (
              <button
                key={c.concept.id}
                type="button"
                aria-pressed={selectedId === c.concept.id}
                onClick={() => setSelectedId(c.concept.id)}
                className={`max-w-[11rem] truncate rounded border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  selectedId === c.concept.id ? 'border-cyan bg-cyan/10 text-cyan' : 'border-line text-ink-dim hover:text-ink'
                }`}
              >
                {title(c.concept)}
              </button>
            ))}
          </div>
          {detailLoading || !detail || !predict ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <>
              <h2 className="mb-3 text-sm font-medium text-ink">{detail.concept.prompt}</h2>
              <ForecastCurve
                predict={predict}
                lastReviewedAt={detail.recallState.lastReviewedAt ? new Date(detail.recallState.lastReviewedAt).getTime() : null}
                attempts={[...detail.attempts].reverse().map(a => ({
                  at: new Date(a.answeredAt).getTime(),
                  predicted: a.predictedRecallProbability,
                  correct: a.actualCorrectness,
                }))}
                now={now}
                targetRecall={target}
                title={title(detail.concept)}
              />
            </>
          )}
        </TerminalPanel>

        <TerminalPanel
          title="REVIEW_QUEUE.EXE"
          className="lg:col-span-2"
          actions={<span className="font-mono text-[11px] text-ink-dim">{fading.length} fading</span>}
        >
          {fading.length === 0 ? (
            <EmptyState title="Queue clear" body="Nothing is below target right now." />
          ) : (
            <ol className="-my-2 divide-y divide-line/60">
              {fading.slice(0, 6).map((item, i) => (
                <li key={item.concept.id} className="flex items-center gap-3 py-3">
                  <span className="w-5 shrink-0 text-center font-mono text-xs text-ink-dim">{i + 1}</span>
                  <ProgressRing value={item.forecast.probability} size={44} strokeWidth={5} label="Estimated recall" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{title(item.concept)}</p>
                    <p className="truncate font-mono text-[11px] text-ink-dim">{whyLine(item)}</p>
                  </div>
                  <StatusPill status={pillFromForecast(item.forecast.status)} className="hidden sm:inline-flex" />
                  <Link
                    href={`/review?concept=${item.concept.id}`}
                    aria-label={`Review: ${title(item.concept)}`}
                    className="rounded border border-line p-2 text-ink-dim transition-colors hover:border-magenta hover:text-magenta"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </TerminalPanel>
      </section>

      {/* 4. Predicted recall rolled up by subject and topic */}
      <MemoryMap />

      {/* 5. Upcoming risk */}
      <TerminalPanel title="UPCOMING_RISK.EXE" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-cyan">ESTIMATE</span>}>
        <p className="mb-4 text-sm text-ink-dim">Concepts that are fine today but expected to drop below your {Math.round(target * 100)}% target within 7 days. Bars show the estimate in 7 days.</p>
        <RetentionBars
          items={crossing.slice(0, 8).map(i => ({
            id: i.concept.id,
            label: `${title(i.concept)} (now ${pct(i.forecast.probability)})`,
            value: probabilityAt(i, WEEK_HOURS),
          }))}
          targetRecall={target}
          emptyText="Nothing crosses below target within 7 days."
        />
      </TerminalPanel>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your memory forecast">
      <Skeleton className="h-44 w-full" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-96 lg:col-span-3" />
        <Skeleton className="h-96 lg:col-span-2" />
      </div>
    </div>
  );
}
