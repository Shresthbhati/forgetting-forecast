'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Pause, Play, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { calculateRecallProbability } from '@/domain/forecasting/engine';
import type { Concept, RecallState } from '@/types';
import { Button, EmptyState, Skeleton, StatTile, StatusPill, SunsetSun, TerminalPanel, pillFromForecast, useToast } from '@/components/ui';

const WEEK_MS = 7 * 24 * 3_600_000;

type Card = {
  concept: Concept;
  recallState: RecallState;
  forecast: { probability: number; status: string };
};

type Phase = 'loading' | 'intro' | 'question' | 'flash' | 'complete';

type Result = { conceptId: string; correct: boolean; confidence: number; before: number; after: number; movedToStrong: boolean };

const pct = (p: number) => `${Math.round(p * 100)}%`;

function ReviewSession() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const focusConcept = searchParams.get('concept');

  const [phase, setPhase] = useState<Phase>('loading');
  const [cards, setCards] = useState<Card[]>([]);
  const [practice, setPractice] = useState(false);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');

  const [answerText, setAnswerText] = useState('');
  const [confidence, setConfidence] = useState(3);
  const [revealed, setRevealed] = useState(false);
  const [grade, setGrade] = useState<'missed' | 'got' | null>(null);
  const [paused, setPaused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<Result | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const requestIdRef = useRef<string>('');
  // Latency timer: milliseconds of ACTIVE time since the prompt appeared. Pausing stops it.
  const activeSinceRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);

  const card = cards[index] ?? null;

  const load = useCallback(
    async (mode: 'due' | 'practice') => {
      setPhase('loading');
      setError('');
      try {
        const { items } = await api.reviewQueue({ mode, maxItems: mode === 'due' ? 20 : 100 });
        let list = items as Card[];
        if (focusConcept) {
          // Start with the requested concept, then the rest of the queue by priority.
          const first = list.find(i => i.concept.id === focusConcept);
          if (first) list = [first, ...list.filter(i => i !== first)];
        }
        setCards(mode === 'practice' && !focusConcept ? list.slice(0, 10) : list);
        setPractice(mode === 'practice');
        setPhase('intro');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load your review queue');
        setPhase('intro');
      }
    },
    [focusConcept]
  );

  useEffect(() => {
    load(focusConcept ? 'practice' : 'due');
  }, [load, focusConcept]);

  // ---- timer helpers ----
  const startTimer = () => {
    activeSinceRef.current = performance.now();
  };
  const stopTimer = () => {
    if (activeSinceRef.current !== null) {
      accumulatedRef.current += performance.now() - activeSinceRef.current;
      activeSinceRef.current = null;
    }
  };
  const elapsedMs = () => accumulatedRef.current + (activeSinceRef.current !== null ? performance.now() - activeSinceRef.current : 0);

  const presentCard = () => {
    setAnswerText('');
    setConfidence(3);
    setRevealed(false);
    setGrade(null);
    setFlash(null);
    setPaused(false);
    accumulatedRef.current = 0;
    requestIdRef.current = crypto.randomUUID();
    startTimer();
  };

  async function begin() {
    if (cards.length === 0) return;
    setResults([]);
    setIndex(0);
    try {
      sessionIdRef.current = (await api.sessions.start('due')).sessionId;
    } catch {
      sessionIdRef.current = null; // reviews still work without a session id
    }
    setPhase('question');
    presentCard();
  }

  const finish = useCallback(async (status: 'completed' | 'abandoned') => {
    stopTimer();
    const id = sessionIdRef.current;
    sessionIdRef.current = null;
    if (id) await api.sessions.finish(id, status).catch(() => {});
  }, []);

  const complete = useCallback(
    async (status: 'completed' | 'abandoned' = 'completed') => {
      await finish(status);
      setPhase('complete');
    },
    [finish]
  );

  function reveal() {
    if (revealed || paused) return;
    setRevealed(true);
    setGrade('got');
  }

  async function submit(correct: boolean) {
    if (!card || submitting || paused) return;
    setSubmitting(true);
    const latency = Math.round(elapsedMs());
    try {
      // The server computes the prediction from stored state BEFORE applying this outcome.
      const res = await api.reviews.submit({
        conceptId: card.concept.id,
        sessionId: sessionIdRef.current,
        clientRequestId: requestIdRef.current, // a retry after a network error reuses the id, so nothing is double counted
        actualCorrectness: correct,
        confidenceLevel: confidence,
        responseLatencyMs: Math.min(Math.max(latency, 1000), 30 * 60 * 1000),
        reviewMode: card.forecast.status === 'Strong' ? 'practice' : 'due',
      });

      stopTimer();
      const at = Date.now() + WEEK_MS;
      const result: Result = {
        conceptId: card.concept.id,
        correct,
        confidence,
        before: calculateRecallProbability(card.concept, card.recallState, new Date(at)),
        after: calculateRecallProbability(card.concept, res.updatedRecallState as RecallState, new Date(at)),
        movedToStrong: card.forecast.status !== 'Strong' && res.forecast?.status === 'Strong',
      };
      setResults(prev => [...prev, result]);
      setFlash(result);
      setPhase('flash');
    } catch (err) {
      // Never show success: the answer stays on screen and the user can retry with the same request id.
      toast('NOT SAVED — retry', {
        variant: 'error',
        action: { label: 'Retry', onClick: () => submit(correct) },
        duration: 8000,
      });
      setError(err instanceof Error ? err.message : 'Failed to save the review');
    } finally {
      setSubmitting(false);
    }
  }

  const next = useCallback(() => {
    if (index + 1 >= cards.length) {
      complete('completed');
      return;
    }
    setIndex(i => i + 1);
    setPhase('question');
    presentCard();
    // presentCard only touches refs and state setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, cards.length, complete]);

  // Short flash, then the next card (Enter skips the wait).
  useEffect(() => {
    if (phase !== 'flash') return;
    const t = setTimeout(next, 2200);
    return () => clearTimeout(t);
  }, [phase, next]);

  const togglePause = useCallback(() => {
    setPaused(p => {
      if (p) startTimer();
      else stopTimer();
      return !p;
    });
  }, []);

  // ---- keyboard ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT';

      if (phase === 'intro' && e.key === 'Enter' && cards.length > 0 && !typing) {
        e.preventDefault();
        begin();
        return;
      }
      if (phase === 'flash' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        next();
        return;
      }
      if (phase !== 'question') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        togglePause();
        return;
      }
      if (paused) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!revealed) reveal();
        else submit(grade === 'got');
        return;
      }
      if (revealed && !typing) {
        if (e.key === 'ArrowLeft') setGrade('missed');
        if (e.key === 'ArrowRight') setGrade('got');
      }
      if (!revealed && !typing && /^[1-5]$/.test(e.key)) setConfidence(Number(e.key));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // begin/reveal/submit close over the latest state through the deps below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cards.length, revealed, grade, paused, confidence, card, submitting, next, togglePause]);

  const stats = useMemo(() => {
    const correct = results.filter(r => r.correct).length;
    return {
      correct,
      total: results.length,
      avgConfidence: results.length ? results.reduce((s, r) => s + r.confidence, 0) / results.length : null,
      toStrong: results.filter(r => r.movedToStrong).length,
    };
  }, [results]);

  // ---------------- render ----------------
  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-3xl space-y-4" aria-busy="true" aria-label="Loading your review queue">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (phase === 'intro') {
    return (
      <div className="mx-auto max-w-2xl">
        <TerminalPanel title="READY_PLAYER_ONE.EXE">
          {error ? (
            <EmptyState
              title="Could not load the queue"
              body={error}
              action={<Button onClick={() => load(practice ? 'practice' : 'due')}>Try again</Button>}
            />
          ) : cards.length === 0 ? (
            <EmptyState
              title="Nothing is due"
              body="All signals are strong. You can still practice your weakest concepts."
              action={
                <div className="flex gap-3">
                  <Button onClick={() => load('practice')}>Practice anyway</Button>
                  <Link href="/"><Button variant="secondary">Dashboard</Button></Link>
                </div>
              }
            />
          ) : (
            <div className="space-y-5 py-4 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">{practice ? '// PRACTICE MODE' : '// DUE NOW'}</p>
              <h1 className="font-display text-3xl font-black uppercase tracking-[0.06em] text-chrome">
                {cards.length} card{cards.length === 1 ? '' : 's'}
              </h1>
              <p className="mx-auto max-w-md text-sm text-ink-dim">
                Try to retrieve each answer before revealing it, and rate your confidence honestly. Every result updates your forecast.
              </p>
              <Button size="lg" onClick={begin}>
                <Play className="h-4 w-4" aria-hidden="true" />
                Start
              </Button>
              <p className="font-mono text-[11px] text-ink-dim">Press Enter to start</p>
            </div>
          )}
        </TerminalPanel>
      </div>
    );
  }

  if (phase === 'complete') {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <TerminalPanel title="SESSION_COMPLETE.EXE">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <SunsetSun size={120} />
            <h1 className="font-display text-2xl font-black uppercase tracking-[0.08em] text-chrome">
              {stats.total > 0 ? 'Signal boosted' : 'Session ended'}
            </h1>
            <p className="max-w-md text-sm text-ink-dim">
              {stats.total > 0
                ? 'Your results were saved and your forecasts have been updated.'
                : 'No cards were answered, so nothing changed.'}
            </p>
          </div>
        </TerminalPanel>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Correct" value={stats.total ? `${stats.correct} / ${stats.total}` : null} glow="magenta" tag="observed" />
          <StatTile label="Avg confidence" value={stats.avgConfidence !== null ? stats.avgConfidence.toFixed(1) : null} unit="/ 5" tag="observed" />
          <StatTile label="Moved to strong" value={stats.total ? stats.toStrong : null} glow="cyan" tag="estimate" />
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/"><Button variant="secondary">Back to dashboard</Button></Link>
          <Button onClick={() => load('due')}>Review more</Button>
        </div>
      </div>
    );
  }

  if (!card) return null;
  const total = cards.length;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-var(--layout-header-height)-6rem)] max-w-3xl flex-col gap-5">
      {/* progress pips */}
      <div className="flex items-center gap-4">
        <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index} aria-label="Session progress">
          {cards.map((c, i) => (
            <span
              key={c.concept.id}
              className={cn(
                'h-2 flex-1 rounded-sm transition-colors',
                i < index ? 'bg-magenta shadow-[var(--glow-magenta)]' : i === index ? 'bg-cyan shadow-[var(--glow-cyan)]' : 'bg-panel-hi'
              )}
            />
          ))}
        </div>
        <span className="font-mono text-sm font-semibold tabular-nums text-ink">{index + 1} / {total}</span>
        <Button size="sm" variant="ghost" onClick={togglePause} aria-label="Pause session">
          <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          Pause
        </Button>
      </div>

      <TerminalPanel
        title={`PROMPT_${String(index + 1).padStart(2, '0')}.EXE`}
        className="flex-1"
        actions={
          <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-ink-dim">
            {card.concept.subject.toUpperCase()} · DIFFICULTY {card.concept.difficulty}/5
          </span>
        }
      >
        {phase === 'flash' && flash ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-4 py-8 text-center animate-[slide-up_300ms_ease-out]" role="status">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">{flash.correct ? '✓ GOT IT' : '✗ MISSED'}</p>
            <h2 className="font-display text-xl font-black uppercase tracking-[0.06em] text-ink">Forecast updated</h2>
            <p className="font-display text-4xl font-black tabular-nums">
              <span className="text-ink-dim">{pct(flash.before)}</span>
              <span className="mx-3 text-magenta" aria-hidden="true">→</span>
              <span className={flash.after >= flash.before ? 'text-strong text-glow-cyan' : 'text-due'}>{pct(flash.after)}</span>
            </p>
            <p className="font-mono text-xs text-ink-dim">estimated recall in 7 days · ESTIMATE</p>
            <p className="font-mono text-[11px] text-ink-dim">Enter to continue</p>
          </div>
        ) : (
          <div className="space-y-6">
            <h1 className="font-display text-xl font-bold leading-snug tracking-[0.02em] text-ink sm:text-2xl">{card.concept.prompt}</h1>
            {card.concept.sourceReference && (
              <p className="-mt-3 font-mono text-[11px] text-ink-dim">From: {card.concept.sourceReference}</p>
            )}

            <div>
              <label htmlFor="answer" className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">
                Your answer · from memory (Shift+Enter for a new line)
              </label>
              <textarea
                id="answer"
                value={answerText}
                onChange={e => setAnswerText(e.target.value)}
                disabled={revealed || paused}
                rows={4}
                placeholder="Write what you remember. Don't look it up."
                className="w-full resize-y rounded-md border border-line bg-night px-4 py-3 text-sm text-ink placeholder:text-neutral-400 focus:border-cyan focus:outline-none focus:shadow-[var(--glow-cyan)] disabled:opacity-60"
              />
            </div>

            <fieldset disabled={revealed || paused}>
              <legend className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">How confident are you? (press 1–5)</legend>
              <div className="flex gap-2" role="radiogroup" aria-label="Confidence">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={confidence === n}
                    onClick={() => setConfidence(n)}
                    className={cn(
                      'h-12 flex-1 rounded-md border font-display text-lg font-bold transition-[box-shadow,background-color,color,border-color]',
                      confidence === n
                        ? 'border-magenta bg-magenta text-void shadow-[var(--glow-magenta)]'
                        : 'border-line bg-panel-hi text-ink-dim hover:border-magenta/60 hover:text-ink',
                      (revealed || paused) && 'opacity-60'
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-[10px] uppercase tracking-wider text-ink-dim">
                <span>Guessing</span>
                <span>Certain</span>
              </div>
            </fieldset>

            {!revealed ? (
              <Button size="lg" fullWidth onClick={reveal} disabled={paused}>
                Reveal
              </Button>
            ) : (
              <div className="space-y-4 animate-[slide-up_300ms_ease-out]">
                <div className="rounded-lg border border-strong/40 bg-success-50 p-4">
                  <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-strong">Expected answer</p>
                  <p className="whitespace-pre-wrap text-sm font-medium text-ink">{card.concept.answer}</p>
                  {card.concept.explanation && <p className="mt-2 text-sm text-ink-dim">{card.concept.explanation}</p>}
                </div>

                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">Did you get it? (←/→ to choose, Enter to confirm)</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    aria-pressed={grade === 'missed'}
                    onClick={() => setGrade('missed')}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-md border py-3 font-semibold uppercase tracking-wider transition-[box-shadow,background-color]',
                      grade === 'missed' ? 'border-due bg-due/15 text-due shadow-[0_0_8px_#ff3d7faa,0_0_24px_#ff3d7f55]' : 'border-line text-ink-dim hover:border-due/60'
                    )}
                  >
                    <X className="h-4 w-4" aria-hidden="true" /> Missed
                  </button>
                  <button
                    type="button"
                    aria-pressed={grade === 'got'}
                    onClick={() => setGrade('got')}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-md border py-3 font-semibold uppercase tracking-wider transition-[box-shadow,background-color]',
                      grade === 'got' ? 'border-strong bg-strong/15 text-strong shadow-[0_0_8px_#39ffb0aa,0_0_24px_#39ffb055]' : 'border-line text-ink-dim hover:border-strong/60'
                    )}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" /> Got it
                  </button>
                </div>
                <Button size="lg" fullWidth loading={submitting} onClick={() => submit(grade === 'got')}>
                  Save result
                </Button>
              </div>
            )}
          </div>
        )}
      </TerminalPanel>

      {/* key hints */}
      <p className="text-center font-mono text-[11px] text-ink-dim" aria-hidden="true">
        <kbd className="rounded border border-line px-1">Enter</kbd> reveal / save ·{' '}
        <kbd className="rounded border border-line px-1">1–5</kbd> confidence ·{' '}
        <kbd className="rounded border border-line px-1">←</kbd>
        <kbd className="rounded border border-line px-1">→</kbd> grade ·{' '}
        <kbd className="rounded border border-line px-1">Esc</kbd> pause
      </p>
      {error && phase === 'question' && (
        <p role="alert" className="text-center font-mono text-xs text-due">
          {error}
        </p>
      )}

      {/* pause overlay: the latency timer is stopped while this is open */}
      {paused && (
        <div role="dialog" aria-modal="true" aria-label="Session paused" className="fixed inset-0 z-[9000] grid place-items-center bg-void/85 px-4 backdrop-blur-sm">
          <TerminalPanel title="PAUSED.EXE" className="w-full max-w-sm">
            <div className="space-y-4 py-2 text-center">
              <p className="font-display text-2xl font-black uppercase tracking-[0.1em] text-chrome">Paused</p>
              <p className="text-sm text-ink-dim">The timer is stopped. Your card is hidden until you resume.</p>
              <div className="flex justify-center gap-3">
                <Button onClick={togglePause}>
                  <Play className="h-3.5 w-3.5" aria-hidden="true" /> Resume
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    setPaused(false);
                    await complete(results.length > 0 ? 'completed' : 'abandoned');
                  }}
                >
                  End session
                </Button>
              </div>
              <p className="font-mono text-[11px] text-ink-dim">Esc to resume</p>
            </div>
          </TerminalPanel>
        </div>
      )}
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-3xl" />}>
      <ReviewSession />
    </Suspense>
  );
}
