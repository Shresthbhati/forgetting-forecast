'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatLocation } from '@/domain/ingestion/location';
import type { QuizResponse } from '@/types';
import { Button, EmptyState, Skeleton, TerminalPanel, useToast } from '@/components/ui';
import { QuizRunner } from '@/components/quiz/QuizRunner';

function QuizContent() {
  const { id } = useParams<{ id: string }>();
  const sectionId = useSearchParams().get('section') ?? '';
  const toast = useToast();

  const [quiz, setQuiz] = useState<QuizResponse | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setQuiz(null);
    try {
      setQuiz(await api.sources.quiz(id, sectionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the quiz');
    }
  }, [id, sectionId]);

  useEffect(() => {
    if (!sectionId) {
      setError('Choose a section from the source to quiz.');
      return;
    }
    load();
  }, [load, sectionId]);

  async function addTermsAndReload() {
    if (!quiz) return;
    setAdding(true);
    try {
      await api.sources.createConcepts(id, { items: quiz.unaddedTermIds.map(termId => ({ type: 'term' as const, termId })) });
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the terms', { variant: 'error' });
    } finally {
      setAdding(false);
    }
  }

  const back = (
    <Link href={`/sources/${id}`} className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-ink-dim hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to source
    </Link>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <TerminalPanel title="SIGNAL_LOST.EXE">
          <div role="alert" className="space-y-3 py-4 text-center">
            <p className="text-sm text-ink-dim">{error}</p>
            {sectionId && <Button onClick={load}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>}
          </div>
        </TerminalPanel>
      </div>
    );
  }
  if (!quiz) {
    return <div className="space-y-4" aria-busy="true">{back}<Skeleton className="h-64 w-full" /></div>;
  }

  if (quiz.questions.length === 0) {
    return (
      <div className="space-y-4">
        {back}
        <TerminalPanel title="EMPTY.EXE">
          <EmptyState
            title="No questions for this section yet"
            body={
              quiz.termsWithoutConcept > 0
                ? `This section has ${quiz.termsWithoutConcept} defined term${quiz.termsWithoutConcept === 1 ? '' : 's'} that ${quiz.termsWithoutConcept === 1 ? "isn't a concept" : "aren't concepts"} yet. Quizzes cover concepts, so every answer counts towards your forecasts.`
                : 'The rules found no definitions or formulas in this section to ask about. You can still make a concept from any passage.'
            }
            action={
              quiz.termsWithoutConcept > 0 ? (
                <Button onClick={addTermsAndReload} loading={adding}>Add {quiz.termsWithoutConcept} term{quiz.termsWithoutConcept === 1 ? '' : 's'} and quiz me</Button>
              ) : undefined
            }
          />
        </TerminalPanel>
      </div>
    );
  }

  const loc = formatLocation(quiz.section.location);
  return (
    <QuizRunner
      questions={quiz.questions}
      heading={`Quiz · ${quiz.section.heading}${loc ? ` · ${loc}` : ''}`}
      metadata={() => ({ source: 'quiz', sourceId: id, sectionId: quiz.section.id })}
      back={back}
      onRestart={load}
      restartLabel="New quiz"
      summaryExtra={<Link href={`/sources/${id}`}><Button variant="secondary">Back to source</Button></Link>}
    />
  );
}

export default function QuizPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <QuizContent />
    </Suspense>
  );
}
