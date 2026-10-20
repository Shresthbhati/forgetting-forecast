'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import type { AnalyticsSummary } from '@/types';
import { Button, EmptyState, Skeleton, StatTile, TerminalPanel } from '@/components/ui';
import { CalibrationChart, RetentionBars, Sparkline } from '@/components/charts';

const MIN = 10;
const pct = (p: number) => `${Math.round(p * 100)}%`;

function PairedBar({ label, accuracy, n, color }: { label: string; accuracy: number | null; n: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between font-mono text-xs">
        <span className="text-ink">{label}</span>
        <span className="text-ink-dim">
          {accuracy === null ? `needs ${MIN}+ attempts (have ${n})` : `${pct(accuracy)} · n = ${n}`}
        </span>
      </div>
      <div className="h-4 overflow-hidden rounded-sm bg-panel-hi" aria-hidden="true">
        {accuracy !== null && <div className="h-full rounded-sm" style={{ width: `${accuracy * 100}%`, background: color, boxShadow: `0 0 10px ${color}` }} />}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [a, setA] = useState<AnalyticsSummary | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [analytics, me] = await Promise.all([api.analytics() as Promise<AnalyticsSummary>, api.me.get().catch(() => null)]);
      setA(analytics);
      setIsDemo(me?.isDemo ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  if (!a) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading analytics">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}</div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const { immediate, delayed } = a.immediateVsDelayed;
  const cal = a.calibration;
  const base = a.baseline;
  const topBucket = [...cal.buckets].sort((x, y) => y.count - x.count)[0];
  const perDay = a.reviewFrequency.map(p => p.count);

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">// DOES THE FORECAST HOLD UP?</p>
        <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.06em] text-chrome">Analytics</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-dim">
          Forecasts are logged before the outcome is known and checked against what actually happened. Every number shows its sample size;
          anything below {MIN} observations is shown as unavailable instead of guessed.
        </p>
      </div>

      {isDemo && (
        <p className="rounded border border-sunset/40 bg-sunset/10 px-4 py-3 font-mono text-xs text-sunset">
          SAMPLE DATA: this account&apos;s history is simulated. The numbers below demonstrate the pipeline, not how well the model predicts a real person.
        </p>
      )}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Immediate accuracy" value={immediate.accuracy !== null ? Math.round(immediate.accuracy * 100) : null} unit="%" tag="observed" foot={`under 24h · n = ${immediate.n}`} emptyHint={`needs ${MIN}+ (have ${immediate.n})`} />
        <StatTile label="Delayed accuracy" value={delayed.accuracy !== null ? Math.round(delayed.accuracy * 100) : null} unit="%" glow="cyan" tag="observed" foot={`72h or more · n = ${delayed.n}`} emptyHint={`needs ${MIN}+ (have ${delayed.n})`} />
        <StatTile label="Brier score" value={cal.brierScore !== null ? cal.brierScore.toFixed(3) : null} tag="observed" foot={`lower is better · n = ${cal.n}`} emptyHint={`needs ${MIN}+ attempts (have ${cal.n})`} />
        <StatTile label="Reviews recorded" value={a.dataPoints} tag="observed" foot={perDay.length > 1 ? <Sparkline values={perDay} label="Reviews per day" /> : undefined} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <TerminalPanel title="IMMEDIATE_VS_DELAYED.EXE" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-strong">OBSERVED</span>}>
          <div className="space-y-4">
            <PairedBar label="Immediate (under 24h)" accuracy={immediate.accuracy} n={immediate.n} color="var(--color-magenta)" />
            <PairedBar label="Delayed (72h or more)" accuracy={delayed.accuracy} n={delayed.n} color="var(--color-cyan)" />
          </div>
          <p className="mt-4 text-sm text-ink-dim">
            {immediate.accuracy !== null && delayed.accuracy !== null
              ? `You recalled ${pct(immediate.accuracy)} of concepts after short gaps and ${pct(delayed.accuracy)} after long ones. The delayed number is the one that reflects durable memory.`
              : 'Both groups need enough attempts before they can be compared.'}
          </p>
        </TerminalPanel>

        <TerminalPanel title="RETENTION_BY_SUBJECT.EXE" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-strong">OBSERVED</span>}>
          <RetentionBars
            items={a.correctnessByTopic.map(t => ({ id: t.topic, label: `${t.topic} (n=${t.totalAttempts})`, value: t.correctnessRate }))}
            emptyText={`Needs ${MIN}+ reviews.`}
          />
        </TerminalPanel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TerminalPanel title="CALIBRATION.EXE" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-strong">OBSERVED</span>}>
          {cal.insufficientData ? (
            <EmptyState title="Not enough data yet" body={`Calibration needs ${MIN}+ reviews (have ${cal.n}).`} />
          ) : (
            <>
              <CalibrationChart buckets={cal.buckets} />
              {topBucket && (
                <p className="mt-4 rounded border border-line bg-night p-3 text-sm text-ink">
                  When the model said about {pct(topBucket.predictedMean)}, you were right {pct(topBucket.observedAccuracy)} of the time (n = {topBucket.count}).
                </p>
              )}
            </>
          )}
        </TerminalPanel>

        <TerminalPanel title="MODEL_VS_BASELINE.EXE" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-strong">OBSERVED</span>}>
          {base.insufficientData ? (
            <EmptyState title="Not enough data yet" body={`The comparison needs ${MIN}+ reviews that follow an earlier review (have ${base.n}).`} />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-ink-dim">Brier score on the same {base.n} attempts. Lower is better; 0.25 is a coin flip.</p>
              <dl className="space-y-3 font-mono text-sm">
                {[
                  { k: 'Forgetting Forecast model', v: base.modelBrier, c: 'text-cyan' },
                  { k: 'Baseline: your past accuracy', v: base.historicalRateBrier, c: 'text-ink' },
                  { k: 'Baseline: fixed 24h half-life', v: base.fixedHalfLifeBrier, c: 'text-ink' },
                ].map(r => (
                  <div key={r.k} className="flex items-baseline justify-between border-b border-line/60 pb-2">
                    <dt className="text-ink-dim">{r.k}</dt>
                    <dd className={`font-semibold tabular-nums ${r.c}`}>{r.v?.toFixed(3)}</dd>
                  </div>
                ))}
              </dl>
              <p className={`rounded border p-3 text-sm ${base.modelBeatsBaseline ? 'border-strong/40 bg-strong/10 text-strong' : 'border-watch/40 bg-watch/10 text-watch'}`}>
                {base.modelBeatsBaseline
                  ? `The model beats the best simple baseline (${base.bestBaseline === 'historical-rate' ? 'your past accuracy' : 'fixed half-life'}) by ${base.brierImprovement?.toFixed(3)} Brier.`
                  : `The model does NOT beat the best simple baseline here (${base.bestBaseline === 'historical-rate' ? 'your past accuracy' : 'fixed half-life'}; it is ${Math.abs(base.brierImprovement ?? 0).toFixed(3)} Brier worse). Treat the forecasts as unproven.`}
              </p>
              <p className="font-mono text-[11px] text-ink-dim">
                The &quot;past accuracy&quot; baseline only sees attempts that happened earlier, so it cannot peek at the future.
              </p>
            </div>
          )}
        </TerminalPanel>
      </div>


      <TerminalPanel title="FEATURE_MODEL.EXP" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-watch">EXPERIMENTAL</span>}>
        {a.featureModel.insufficientData ? (
          <EmptyState title="Not enough data yet" body={`The challenger needs ${MIN}+ reviews that follow an earlier review (have ${a.featureModel.n}).`} />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-dim">
              A challenger that also uses the <strong className="text-ink">question type</strong> and the <strong className="text-ink">topic</strong>, learned only from your earlier answers. Brier score on the same {a.featureModel.n} attempts as above; lower is better.
            </p>
            <dl className="space-y-3 font-mono text-sm">
              {[
                { k: 'Current model (v1)', v: a.featureModel.v1Brier, c: 'text-cyan' },
                { k: 'Challenger (question type + topic)', v: a.featureModel.v2Brier, c: 'text-ink' },
                { k: 'Baseline: your past accuracy', v: a.featureModel.historicalRateBrier, c: 'text-ink' },
                { k: 'Baseline: fixed 24h half-life', v: a.featureModel.fixedHalfLifeBrier, c: 'text-ink' },
              ].map(r => (
                <div key={r.k} className="flex items-baseline justify-between border-b border-line/60 pb-2">
                  <dt className="text-ink-dim">{r.k}</dt>
                  <dd className={`font-semibold tabular-nums ${r.c}`}>{r.v?.toFixed(3)}</dd>
                </div>
              ))}
            </dl>
            <p className={`rounded border p-3 text-sm ${a.featureModel.worthPromoting ? 'border-strong/40 bg-strong/10 text-strong' : 'border-watch/40 bg-watch/10 text-watch'}`}>
              {a.featureModel.worthPromoting
                ? `The challenger beats v1 (by ${a.featureModel.improvementOverV1?.toFixed(3)} Brier) and both baselines on ${a.featureModel.n} attempts. It would be worth switching scheduling to it.`
                : a.featureModel.v2BeatsV1
                  ? `The challenger is ahead of v1 by ${a.featureModel.improvementOverV1?.toFixed(3)} Brier but has not cleared the bar (it must also beat both baselines, with 30+ attempts). Scheduling still uses v1.`
                  : `The challenger does NOT beat v1 on your data (${Math.abs(a.featureModel.improvementOverV1 ?? 0).toFixed(3)} Brier worse). Scheduling uses v1.`}
            </p>
            {(a.featureModel.learned.byType.length > 0) && (
              <div>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-dim">Learned per question type (accuracy vs what v1 predicted)</p>
                <ul className="space-y-1 font-mono text-xs">
                  {a.featureModel.learned.byType.map(t => (
                    <li key={t.key} className="flex justify-between gap-3">
                      <span className="text-ink">{t.key} <span className="text-ink-dim">n={t.n}</span></span>
                      <span className="text-ink-dim">observed {pct(t.accuracy)} · predicted {pct(t.meanPredicted)} · ×{t.ratio.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </TerminalPanel>

      <TerminalPanel title="FORECAST_LOG_REPORT.EXE" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-cyan">ESTIMATE VS OBSERVED</span>}>
        {a.forecastLog.byHorizon.length === 0 ? (
          <EmptyState title="No evaluated forecasts yet" body="Forecasts are checked when you review the same concept again within the forecast window." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-sm">
                <caption className="sr-only">Forecast error by horizon</caption>
                <thead className="text-[10px] uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th scope="col" className="py-2 font-semibold">Horizon</th>
                    <th scope="col" className="py-2 font-semibold">Evaluated</th>
                    <th scope="col" className="py-2 font-semibold">Mean absolute error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {a.forecastLog.byHorizon.map(h => (
                    <tr key={h.horizonHours}>
                      <td className="py-2 text-ink">{h.horizonHours / 24} day{h.horizonHours === 24 ? '' : 's'}</td>
                      <td className="py-2 text-ink-dim">{h.evaluated}</td>
                      <td className="py-2 tabular-nums text-ink">{h.meanAbsError !== null ? h.meanAbsError.toFixed(3) : `needs ${MIN}+`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 font-mono text-[11px] text-ink-dim">
              {a.forecastLog.evaluated} evaluated · {a.forecastLog.pending} not yet evaluated. Mean absolute error is the average gap between the forecast probability and what happened (1 or 0).
            </p>
          </>
        )}
      </TerminalPanel>
    </div>
  );
}
