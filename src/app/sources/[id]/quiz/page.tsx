'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, RotateCcw, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatLocation } from '@/domain/ingestion/location';
import { gradeResponse } from '@/domain/assessment/grading';
import type { Grade, Question, QuestionType } from '@/domain/assessment/types';
import type { QuizResponse } from '@/types';
import { Badge, Button, EmptyState, Skeleton, TerminalPanel, Textarea, useToast } from '@/components/ui';

const TYPE_LABEL: Record<QuestionType, string> = {
  definition: 'Definition recall',
  cloze: 'Fill in the blank',
  mcq: 'Multiple choice',
  truefalse: 'True / false',
  numerical: 'Calculation',
};

interface Outcome {
  question: Question;
  final: boolean;
  recorded: boolean;
}

function QuizContent() {
  const { id } = useParams<{ id: string }>();
  const sectionId = useSearchParams().get('section') ?? '';
  const toast = useToast();

  const [quiz, setQuiz] = useState<QuizResponse | null>(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [final, setFinal] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  const shownAt = useRef(0);
  const requestId = useRef('');
  const elapsed = useRef(0);

  const load = useCallback(async () => {
    setError('');
    setQuiz(null);
    setIndex(0);
    setOutcomes([]);
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

  const question = quiz?.questions[index] ?? null;

  // Reset per-question state whenever a new question is shown.
  useEffect(() => {
    setResponse('');
    setGrade(null);
    setFinal(null);
    requestId.current = crypto.randomUUID();
    shownAt.current = performance.now();
  }, [question?.id, index]);

  const check = useCallback(
    (answer: string) => {
      if (!question || grade) return;
      elapsed.current = Math.round(performance.now() - shownAt.current);
      const g = gradeResponse(question, answer);
      setGrade(g);
      setFinal(g.correct);
    },
    [question, grade]
  );

  async function saveAndContinue() {
    if (!question || !grade || final === null || !quiz) return;
    setSaving(true);
    let recorded = false;
    try {
      if (!question.practiceOnly && question.conceptId) {
        await api.reviews.submit({
          conceptId: question.conceptId,
          clientRequestId: requestId.current,
          actualCorrectness: final,
          responseLatencyMs: Math.min(elapsed.current, 30 * 60 * 1000),
          reviewMode: 'practice',
          metadata: {
            source: 'quiz',
            generated: true,
            questionType: question.type,
            questionId: question.id,
            grading: grade.method,
            autoVerdict: grade.correct,
            overridden: final !== grade.correct,
            score: Math.round(grade.score * 100) / 100,
            sourceId: id,
            sectionId: quiz.section.id,
          },
        });
        recorded = true;
      }
      setOutcomes(prev => [...prev, { question, final, recorded }]);
      setIndex(i => i + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save this answer. Try again.', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

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

  const loc = formatLocation(quiz.section.location);

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

  // ---- finished ----
  if (!question) {
    const correct = outcomes.filter(o => o.final).length;
    const recorded = outcomes.filter(o => o.recorded).length;
    return (
      <div className="space-y-4">
        {back}
        <TerminalPanel title="QUIZ_COMPLETE.EXE">
          <div className="space-y-4 py-2 text-center" role="status">
            <p className="font-display text-4xl font-black text-chrome">{correct} / {outcomes.length}</p>
            <p className="text-sm text-ink-dim">
              counted correct. {recorded} answer{recorded === 1 ? ' was' : 's were'} recorded as attempts and will feed your forecasts
              {outcomes.length - recorded > 0 ? `; ${outcomes.length - recorded} practice-only (not recorded).` : '.'}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={load}>New quiz</Button>
              <Link href={`/sources/${id}`}><Button variant="secondary">Back to source</Button></Link>
            </div>
          </div>
        </TerminalPanel>
      </div>
    );
  }

  const isChoice = question.grading === 'exact';
  const total = quiz.questions.length;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {back}
      <div className="flex items-center justify-between gap-3 font-mono text-xs text-ink-dim">
        <span className="min-w-0 truncate">Quiz · {quiz.section.heading}{loc ? ` · ${loc}` : ''}</span>
        <span aria-live="polite">{index + 1} / {total}</span>
      </div>
      <div role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index} className="h-1.5 overflow-hidden rounded bg-panel-hi">
        <div className="h-full bg-magenta transition-[width]" style={{ width: `${(index / total) * 100}%` }} />
      </div>

      <TerminalPanel title={`QUESTION_${String(index + 1).padStart(2, '0')}.EXE`}>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="sm">{TYPE_LABEL[question.type]}</Badge>
            <span className="font-mono text-[11px] text-ink-dim">{question.label}</span>
            {question.practiceOnly && <Badge size="sm" variant="warning">Practice only · not recorded</Badge>}
          </div>

          <h1 className="break-words font-display text-lg font-bold leading-snug text-ink sm:text-xl">{question.prompt}</h1>

          {isChoice ? (
            <div role="radiogroup" aria-label="Answer options" className="grid gap-2">
              {(question.options ?? []).map(option => {
                const chosen = response === option;
                const isAnswer = grade && option === question.answer;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    disabled={grade !== null}
                    onClick={() => {
                      setResponse(option);
                      check(option);
                    }}
                    className={cn(
                      'min-h-11 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      !grade && 'border-line text-ink hover:border-cyan',
                      grade && isAnswer && 'border-strong/60 bg-strong/10 text-ink',
                      grade && chosen && !isAnswer && 'border-due/60 bg-due/10 text-ink',
                      grade && !chosen && !isAnswer && 'border-line text-ink-dim'
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          ) : (
            <form
              onSubmit={e => {
                e.preventDefault();
                check(response);
              }}
              className="space-y-3"
            >
              <Textarea
                label={question.grading === 'numeric' ? 'Your answer (a number)' : 'Your answer'}
                value={response}
                onChange={e => setResponse(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    check(response);
                  }
                }}
                disabled={grade !== null}
                rows={question.grading === 'numeric' ? 1 : 3}
                autoFocus
              />
              {!grade && <Button type="submit">Check answer</Button>}
            </form>
          )}

          {grade && final !== null && (
            <div className="space-y-4 rounded-lg border border-line bg-night p-4" role="status">
              <p className={cn('flex items-center gap-2 font-semibold', grade.correct ? 'text-strong' : 'text-due')}>
                {grade.correct ? <Check className="h-5 w-5" aria-hidden="true" /> : <X className="h-5 w-5" aria-hidden="true" />}
                {grade.correct ? 'Marked correct' : 'Marked incorrect'}
              </p>
              <div className="space-y-1 text-sm">
                <p className="font-mono text-[11px] uppercase tracking-wider text-ink-dim">Answer</p>
                <p className="break-words text-ink">{question.answer}</p>
                {question.explanation && question.explanation !== question.answer && (
                  <p className="break-words text-ink-dim">{question.explanation}</p>
                )}
                <p className="font-mono text-[11px] text-ink-dim">{question.label}</p>
              </div>

              {grade.needsReview && (
                <fieldset className="space-y-2">
                  <legend className="text-sm text-ink">
                    <span className="font-semibold">Graded automatically</span> ({grade.detail}) — override?
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {([[true, 'Count as correct'], [false, 'Count as incorrect']] as const).map(([value, label]) => (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={final === value}
                        onClick={() => setFinal(value)}
                        className={cn(
                          'min-h-11 rounded border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors',
                          final === value ? 'border-magenta bg-magenta/15 text-magenta' : 'border-line text-ink-dim hover:text-ink'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {final !== grade.correct && <p className="text-xs text-ink-dim">You overrode the automatic grade. This is what will be saved.</p>}
                </fieldset>
              )}

              <Button onClick={saveAndContinue} loading={saving}>
                {question.practiceOnly ? 'Continue' : 'Save and continue'}
              </Button>
              {question.practiceOnly && <p className="text-xs text-ink-dim">Calculations come from formulas in the text, not a concept, so they are not recorded in your forecasts.</p>}
            </div>
          )}
        </div>
      </TerminalPanel>
    </div>
  );
}

export default function QuizPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <QuizContent />
    </Suspense>
  );
}
