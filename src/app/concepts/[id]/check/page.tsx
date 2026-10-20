'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import type { PrerequisitesResponse } from '@/types';
import { Button, EmptyState, Skeleton, TerminalPanel } from '@/components/ui';
import { QuizRunner } from '@/components/quiz/QuizRunner';

/** Probe questions for the prerequisites of one concept ("Struggling with B -> check A"). */
export default function PrerequisiteCheckPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PrerequisitesResponse | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setData(null);
    try {
      setData(await api.concepts.prerequisites(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the check');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <Link href={`/concepts/${id}`} className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-ink-dim hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to concept
    </Link>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <TerminalPanel title="SIGNAL_LOST.EXE">
          <div role="alert" className="space-y-3 py-4 text-center">
            <p className="text-sm text-ink-dim">{error}</p>
            <Button onClick={load}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>
          </div>
        </TerminalPanel>
      </div>
    );
  }
  if (!data) return <div className="space-y-4" aria-busy="true">{back}<Skeleton className="h-64 w-full" /></div>;

  if (!data.questions?.length) {
    return (
      <div className="space-y-4">
        {back}
        <TerminalPanel title="EMPTY.EXE">
          <EmptyState title="Nothing to check" body={data.unavailableReason ?? 'None of this concept’s prerequisites need a check right now, or they are not concepts yet.'} />
        </TerminalPanel>
      </div>
    );
  }

  return (
    <QuizRunner
      questions={data.questions}
      heading={`Prerequisites of “${data.focus?.term}”`}
      metadata={() => ({ source: 'prerequisite-probe', forConceptId: id })}
      back={back}
      onRestart={load}
      restartLabel="Check again"
      summaryExtra={<Link href={`/concepts/${id}`}><Button variant="secondary">Back to concept</Button></Link>}
    />
  );
}
