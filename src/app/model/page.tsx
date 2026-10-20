'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { calculateRecallProbability, MODEL_VERSION } from '@/domain/forecasting/engine';
import type { Concept, RecallState } from '@/types';
import { Button, Skeleton, StatusPill, TerminalPanel, pillFromProbability } from '@/components/ui';

const HOUR = 3_600_000;
const PRESETS = [
  { label: 'NOW', hours: 0 },
  { label: '+1D', hours: 24 },
  { label: '+3D', hours: 72 },
  { label: '+7D', hours: 168 },
  { label: '+14D', hours: 336 },
];

type Item = { concept: Concept; recallState: RecallState };

function AssumptionRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line/60 py-2.5 last:border-0">
      <span className="text-sm text-ink-dim">{label}</span>
      <span className={cn('font-mono text-xs font-semibold', tone)}>{value}</span>
    </div>
  );
}

const steps = [
  { n: '01', title: 'Collect delayed outcomes', body: 'Ask the same concept after controlled delays. Do not use training results as test data.', href: '/history', cta: 'See attempts' },
  { n: '02', title: 'Measure calibration', body: 'Compare predicted recall with observed accuracy using the Brier score and reliability bins.', href: '/analytics', cta: 'See calibration' },
  { n: '03', title: 'Compare baselines', body: 'Evaluate against simple baselines on the same attempts, with no look-ahead.', href: '/analytics', cta: 'See comparison' },
];

export default function ModelLabPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  // The simulation clock is fixed when the page loads; the slider moves it forward from there.
  const [start] = useState(() => Date.now());
  const [hoursAhead, setHoursAhead] = useState(0);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.reviewQueue({ mode: 'practice', maxItems: 100 });
      setItems((res.items as Item[]).map(i => ({ concept: i.concept, recallState: i.recallState })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your concepts');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const at = new Date(start + hoursAhead * HOUR);
    return (items ?? [])
      .map(i => ({ ...i, p: calculateRecallProbability(i.concept, i.recallState, at) }))
      .sort((a, b) => a.p - b.p);
  }, [items, start, hoursAhead]);

  function exportModel() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            model: MODEL_VERSION,
            formula: 'P(t) = 0.5 ^ (t / H) * difficultyAdjustment',
            concepts: (items ?? []).map(i => ({
              conceptId: i.concept.id,
              difficulty: i.concept.difficulty,
              halfLifeHours: i.recallState.estimatedHalfLifeHours,
              repetitions: i.recallState.repetitionCount,
              lastReviewedAt: i.recallState.lastReviewedAt,
            })),
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'forgetting-forecast-model.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">// EXPERIMENTAL MODEL</p>
          <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.06em] text-chrome">The Lab</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-dim">Inspect the assumptions, move time forward, and challenge the forecast.</p>
        </div>
        <Button variant="secondary" onClick={exportModel} disabled={!items}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Export model + states
        </Button>
      </div>

      <p className="rounded border border-watch/40 bg-watch/10 px-4 py-3 text-sm text-watch">
        <strong>Model limitation.</strong> The half-life update rule is heuristic. It is not fitted to a validated population dataset, and its
        probabilities should not be treated as calibrated until compared with held-out delayed results (see Analytics).
      </p>

      <div className="grid gap-6 lg:grid-cols-5">
        <TerminalPanel
          title="TIME_MACHINE.EXE"
          className="lg:col-span-3"
          actions={<span className="rounded border border-sunset/50 bg-sunset/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-sunset">SIMULATION</span>}
        >
          <p className="mb-4 text-sm text-ink-dim">Each bar is the model&apos;s estimate if you did not review for the chosen time. Nothing here is saved.</p>

          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="horizon" className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">Move forecast time forward</label>
            <output htmlFor="horizon" className="font-display text-lg font-bold tabular-nums text-cyan text-glow-cyan">
              {hoursAhead >= 48 ? `${(hoursAhead / 24).toFixed(hoursAhead % 24 ? 1 : 0)} days` : `${hoursAhead} hours`}
            </output>
          </div>
          <input
            id="horizon"
            type="range"
            min={0}
            max={336}
            step={6}
            value={hoursAhead}
            onChange={e => setHoursAhead(Number(e.target.value))}
            className="h-2 w-full cursor-pointer accent-cyan"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                aria-pressed={hoursAhead === p.hours}
                onClick={() => setHoursAhead(p.hours)}
                className={cn('rounded border px-3 py-1 font-mono text-[11px] font-semibold tracking-wider transition-colors', hoursAhead === p.hours ? 'border-cyan bg-cyan text-void' : 'border-line text-ink-dim hover:text-ink')}
              >
                {p.label}
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setHoursAhead(0)}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Reset</Button>
          </div>

          <div className="mt-5 max-h-[28rem] space-y-1 overflow-y-auto pr-1">
            {error ? (
              <div role="alert" className="space-y-3 py-6 text-center">
                <p className="text-sm text-ink-dim">{error}</p>
                <Button onClick={load}>Retry</Button>
              </div>
            ) : items === null ? (
              <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : rows.length === 0 ? (
              <p className="py-6 text-center font-mono text-xs text-ink-dim">No concepts yet. Add some in the Library.</p>
            ) : (
              rows.map(r => {
                const status = pillFromProbability(r.p);
                const color = status === 'strong' ? 'var(--color-strong)' : status === 'watch' ? 'var(--color-watch)' : 'var(--color-due)';
                return (
                  <div key={r.concept.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-panel-hi/50">
                    <div className="min-w-0 flex-1">
                      <Link href={`/concepts/${r.concept.id}`} className="block truncate text-sm text-ink hover:text-cyan">{r.concept.prompt}</Link>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-dim">{r.concept.subject}</p>
                    </div>
                    <div className="h-2 w-24 shrink-0 overflow-hidden rounded-sm bg-panel-hi" aria-hidden="true">
                      <div className="h-full rounded-sm transition-[width] duration-300" style={{ width: `${r.p * 100}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
                    </div>
                    <span className="w-11 text-right font-mono text-xs font-bold tabular-nums text-ink">{Math.round(r.p * 100)}%</span>
                    <StatusPill status={status} className="hidden sm:inline-flex" />
                  </div>
                );
              })
            )}
          </div>
        </TerminalPanel>

        <TerminalPanel title="MODEL_SPEC.EXE" className="lg:col-span-2" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-ink-dim">{MODEL_VERSION}</span>}>
          <div className="rounded-md border border-line bg-night p-4 font-mono">
            <p className="text-[11px] uppercase tracking-wider text-ink-dim">Recall probability</p>
            <p className="mt-2 text-lg font-semibold text-cyan text-glow-cyan">P(t) = 0.5 ^ (t / H)</p>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">
              t = hours since the last review (or since the concept was created, if never reviewed). H = the estimated half-life in hours.
              A small difficulty adjustment is applied as a prior.
            </p>
          </div>
          <div className="mt-4">
            <AssumptionRow label="Correct answer" value="raises half-life" tone="text-strong" />
            <AssumptionRow label="Incorrect answer" value="lowers half-life" tone="text-due" />
            <AssumptionRow label="Confidence and latency" value="adjust the size of the update" tone="text-cyan" />
            <AssumptionRow label="Target recall" value="80%" tone="text-ink" />
            <AssumptionRow label="Calibration status" value="measured on Analytics" tone="text-watch" />
          </div>
        </TerminalPanel>
      </div>

      <TerminalPanel title="VALIDATION_PLAN.EXE" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-ink-dim">WHAT WE MUST PROVE</span>}>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map(s => (
            <li key={s.n} className="rounded-md border border-line bg-night p-4">
              <span className="font-mono text-[11px] tracking-[0.2em] text-magenta">{s.n}</span>
              <h3 className="mt-1 font-display text-sm font-bold uppercase tracking-[0.08em] text-ink">{s.title}</h3>
              <p className="mt-2 text-sm text-ink-dim">{s.body}</p>
              <Link href={s.href} className="mt-3 inline-block font-mono text-[11px] font-semibold uppercase tracking-wider text-cyan hover:underline">{s.cta} →</Link>
            </li>
          ))}
        </ol>
      </TerminalPanel>
    </div>
  );
}
