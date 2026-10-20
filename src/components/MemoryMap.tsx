'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { SubjectRollup } from '@/domain/forecasting/rollup';
import { EmptyState, Skeleton, TerminalPanel } from '@/components/ui';

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Predicted recall by subject, expandable to topics. An estimate: labelled as such, with its sample sizes. */
export function MemoryMap() {
  const [data, setData] = useState<{ targetRecall: number; subjects: SubjectRollup[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.rollup().then(d => !cancelled && setData(d)).catch(err => !cancelled && setError(err instanceof Error ? err.message : 'Could not load the memory map'));
    return () => {
      cancelled = true;
    };
  }, []);

  const bar = (value: number, target: number) => (
    <div className="relative h-2 flex-1 overflow-hidden rounded bg-panel-hi" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label="Predicted recall">
      <div className={cn('h-full', value >= target ? 'bg-strong' : value >= 0.55 ? 'bg-watch' : 'bg-due')} style={{ width: `${value * 100}%` }} />
      <span className="absolute inset-y-0 w-px bg-ink/60" style={{ left: `${target * 100}%` }} />
    </div>
  );

  return (
    <TerminalPanel title="MEMORY_MAP.EXE" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-cyan">ESTIMATE</span>}>
      {error ? (
        <p role="alert" className="py-3 text-center text-sm text-ink-dim">{error}</p>
      ) : !data ? (
        <Skeleton className="h-32 w-full" aria-busy="true" />
      ) : data.subjects.length === 0 ? (
        <EmptyState title="Nothing to map yet" body="Add concepts and the app rolls their predicted recall up to topics and subjects here." />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-dim">
            Predicted recall by subject and topic (the line marks your {pct(data.targetRecall)} target). Concepts you haven&apos;t reviewed yet sit on the model&apos;s starting estimate.
          </p>
          <ul className="space-y-2">
            {data.subjects.map(s => (
              <li key={s.key} className="rounded-lg border border-line bg-panel/60">
                <details>
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="min-w-0 flex-1 break-words text-sm font-semibold text-ink">{s.key}</span>
                    <span className="font-mono text-[11px] text-ink-dim">{s.concepts} concept{s.concepts === 1 ? '' : 's'} · {s.atRisk} below target · {s.reviewed} reviewed</span>
                    <span className="flex w-full items-center gap-3 sm:w-48">{bar(s.meanRecall, data.targetRecall)}<span className="w-10 text-right font-mono text-sm text-ink">{pct(s.meanRecall)}</span></span>
                  </summary>
                  <ul className="space-y-2 border-t border-line px-3 py-3">
                    {s.topics.map(t => (
                      <li key={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1 break-words text-sm text-ink-dim">{t.key}</span>
                        <span className="font-mono text-[11px] text-ink-dim">{t.concepts} · {t.atRisk} below</span>
                        <span className="flex w-full items-center gap-3 sm:w-48">{bar(t.meanRecall, data.targetRecall)}<span className="w-10 text-right font-mono text-xs text-ink">{pct(t.meanRecall)}</span></span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </TerminalPanel>
  );
}
