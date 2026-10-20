'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RotateCcw, Shuffle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { MixedTestResponse } from '@/types';
import { Button, EmptyState, Skeleton, TerminalPanel } from '@/components/ui';
import { QuizRunner } from '@/components/quiz/QuizRunner';

const SIZES = [5, 10, 15, 20];

export default function MixedTestPage() {
  const [size, setSize] = useState(10);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [data, setData] = useState<MixedTestResponse | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setData(null);
    setRunning(false);
    try {
      setData(await api.mixedTest({ size, subjects }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the test');
    }
  }, [size, subjects]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (subject: string) =>
    setSubjects(prev => (prev.includes(subject) ? prev.filter(s => s !== subject) : [...prev, subject]));

  if (running && data) {
    return (
      <QuizRunner
        questions={data.questions}
        heading={`Mixed test · ${new Set(data.questions.map(q => q.subject)).size} subject(s)`}
        metadata={() => ({ source: 'mixed-test', seed: data.seed })}
        back={<button type="button" onClick={() => setRunning(false)} className="font-mono text-xs uppercase tracking-wider text-ink-dim hover:text-ink">← Test setup</button>}
        onRestart={load}
        restartLabel="New test"
        summaryExtra={<Link href="/"><Button variant="secondary">Dashboard</Button></Link>}
      />
    );
  }

  const generated = data?.questions.filter(q => q.type !== 'recall').length ?? 0;
  const own = (data?.questions.length ?? 0) - generated;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">// ACROSS SUBJECTS</p>
        <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.06em] text-chrome">Mixed test</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-dim">
          Questions drawn from every subject, interleaved, and weighted towards the concepts predicted to fade (and the ones you&apos;ve lapsed on). For concepts made from your sources, you get a different generated item than last time, so the test checks understanding rather than memorised wording.
        </p>
      </div>

      {error ? (
        <TerminalPanel title="SIGNAL_LOST.EXE">
          <div role="alert" className="space-y-3 py-4 text-center">
            <p className="text-sm text-ink-dim">{error}</p>
            <Button onClick={load}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>
          </div>
        </TerminalPanel>
      ) : !data ? (
        <Skeleton className="h-64 w-full" aria-busy="true" />
      ) : data.conceptsConsidered === 0 ? (
        <TerminalPanel title="EMPTY.EXE">
          <EmptyState
            title={data.subjectsAvailable.length === 0 ? 'No concepts yet' : 'No concepts in those subjects'}
            body={data.subjectsAvailable.length === 0 ? 'Add concepts in the library, or upload a source and add its key terms.' : 'Pick different subjects, or clear the filter.'}
            action={data.subjectsAvailable.length === 0 ? <Link href="/sources"><Button>Go to sources</Button></Link> : <Button onClick={() => setSubjects([])}>Clear filter</Button>}
          />
        </TerminalPanel>
      ) : (
        <TerminalPanel title="TEST_SETUP.CFG">
          <div className="space-y-5">
            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-dim">Questions</p>
              <div role="group" aria-label="Number of questions" className="flex flex-wrap gap-2">
                {SIZES.map(n => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={size === n}
                    onClick={() => setSize(n)}
                    className={cn('min-h-11 rounded border px-4 py-1.5 font-mono text-xs font-semibold transition-colors', size === n ? 'border-magenta bg-magenta/15 text-magenta' : 'border-line text-ink-dim hover:text-ink')}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-dim">Subjects {subjects.length === 0 && '(all)'}</p>
              <div role="group" aria-label="Subjects" className="flex flex-wrap gap-2">
                {data.subjectsAvailable.map(s => (
                  <button
                    key={s.subject}
                    type="button"
                    aria-pressed={subjects.includes(s.subject)}
                    onClick={() => toggle(s.subject)}
                    className={cn('min-h-11 rounded border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors', subjects.includes(s.subject) ? 'border-magenta bg-magenta/15 text-magenta' : 'border-line text-ink-dim hover:text-ink')}
                  >
                    {s.subject} · {s.concepts}
                  </button>
                ))}
              </div>
            </div>

            <p className="rounded border border-line bg-night p-3 text-sm text-ink-dim" role="status">
              {data.questions.length} question{data.questions.length === 1 ? '' : 's'} ready: {generated} generated from your sources, {own} written by you. Short and numeric answers are graded automatically, and you can override each grade before it&apos;s saved.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setRunning(true)}><Shuffle className="h-4 w-4" aria-hidden="true" />Start test</Button>
              <Button variant="ghost" onClick={load}>Draw a different set</Button>
            </div>
          </div>
        </TerminalPanel>
      )}
    </div>
  );
}
