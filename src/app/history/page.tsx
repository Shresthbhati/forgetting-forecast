'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ReviewHistoryPage } from '@/types';
import { Button, EmptyState, Skeleton, TerminalPanel } from '@/components/ui';

const PAGE_SIZE = 20;
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'correct', label: '✓ Correct' },
  { value: 'incorrect', label: '✗ Missed' },
] as const;

const stamp = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export default function HistoryPage() {
  const [data, setData] = useState<ReviewHistoryPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<'' | 'correct' | 'incorrect'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(
        await api.reviews.list({
          page,
          pageSize: PAGE_SIZE,
          result: result || undefined,
          // date inputs give YYYY-MM-DD; cover the whole local day
          from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [page, result, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const changeFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">// EVERY ATTEMPT, NEWEST FIRST</p>
        <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.06em] text-chrome">History</h1>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div role="group" aria-label="Filter by result" className="flex overflow-hidden rounded border border-line">
          {FILTERS.map(f => (
            <button
              key={f.value || 'all'}
              type="button"
              aria-pressed={result === f.value}
              onClick={() => changeFilter(() => setResult(f.value))}
              className={cn('px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors', result === f.value ? 'bg-magenta text-void' : 'text-ink-dim hover:text-ink')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="font-mono text-[11px] uppercase tracking-wider text-ink-dim">
          From
          <input type="date" value={from} onChange={e => changeFilter(() => setFrom(e.target.value))} className="ml-2 rounded border border-line bg-night px-2 py-1 text-ink focus:border-cyan focus:outline-none" />
        </label>
        <label className="font-mono text-[11px] uppercase tracking-wider text-ink-dim">
          To
          <input type="date" value={to} onChange={e => changeFilter(() => setTo(e.target.value))} className="ml-2 rounded border border-line bg-night px-2 py-1 text-ink focus:border-cyan focus:outline-none" />
        </label>
        {(from || to || result) && (
          <Button size="sm" variant="ghost" onClick={() => { setFrom(''); setTo(''); setResult(''); setPage(1); }}>Clear filters</Button>
        )}
      </div>

      <TerminalPanel title="REVIEW_LOG.TXT" padded={false} actions={<span className="font-mono text-[10px] tracking-[0.14em] text-strong">OBSERVED</span>}>
        {error ? (
          <div role="alert" className="space-y-3 p-6 text-center">
            <p className="text-sm text-ink-dim">{error}</p>
            <Button onClick={load}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>
          </div>
        ) : loading && !data ? (
          <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No reviews found" body={result || from || to ? 'No attempts match these filters.' : 'Review a concept and it will appear here.'} />
        ) : data ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left font-mono text-xs">
              <caption className="sr-only">Review attempts, newest first</caption>
              <thead className="border-b border-line text-[10px] uppercase tracking-wider text-ink-dim">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Date</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Concept</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Result</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Predicted</th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">Conf</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Latency</th>
                </tr>
              </thead>
              <tbody className={cn('divide-y divide-line/50', loading && 'opacity-60')}>
                {data.items.map(r => (
                  <tr key={r.id} className="hover:bg-panel-hi/50">
                    <td className="whitespace-nowrap px-4 py-2 text-ink-dim">{stamp(r.answeredAt)}</td>
                    <td className="max-w-[22rem] truncate px-2 py-2">
                      <Link href={`/concepts/${r.conceptId}`} className="text-ink hover:text-cyan">{r.conceptPrompt}</Link>
                    </td>
                    <td className="px-2 py-2">
                      <span className={cn('font-bold', r.actualCorrectness ? 'text-strong' : 'text-due')}>{r.actualCorrectness ? '✓ GOT IT' : '✗ MISSED'}</span>
                    </td>
                    <td className="px-2 py-2 tabular-nums text-ink-dim">{Math.round(r.predictedRecallProbability * 100)}%</td>
                    <td className="px-2 py-2 tabular-nums text-ink-dim">{r.selfReportedConfidence !== null ? `${Math.round(r.selfReportedConfidence * 5)}/5` : '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-dim">{(r.responseLatencyMs / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </TerminalPanel>

      {data && data.total > 0 && (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          <p className="font-mono text-xs text-ink-dim">{data.total} attempts · page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" />Prev</Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages || loading} onClick={() => setPage(p => p + 1)}>Next<ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </nav>
      )}
    </div>
  );
}
