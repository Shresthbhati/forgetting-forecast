'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { gradeResponse } from '@/domain/assessment/grading';
import type { Grade, Question, QuestionType } from '@/domain/assessment/types';
import { Badge, Button, TerminalPanel, Textarea, useToast } from '@/components/ui';

export const TYPE_LABEL: Record<QuestionType, string> = {
  definition: 'Definition recall',
  cloze: 'Fill in the blank',
  mcq: 'Multiple choice',
  truefalse: 'True / false',
  numerical: 'Calculation',
  recall: 'Recall',
};

export type RunnerQuestion = Question & { subject?: string; predictedRecall?: number };

interface Outcome {
  final: boolean;
  recorded: boolean;
}

export interface QuizRunnerProps {
  questions: RunnerQuestion[];
  /** Text above the progress bar, e.g. the section heading. */
  heading: string;
  /** Extra metadata saved with every attempt (the runner adds the question type, grading method and override flag). */
  metadata: (q: Question) => Record<string, unknown>;
  /** Link back to wherever the quiz came from. */
  back: ReactNode;
  /** Shown on the summary screen. */
  onRestart: () => void;
  restartLabel: string;
  summaryExtra?: ReactNode;
}

/**
 * Runs a list of generated questions: grades each, shows "Graded automatically — override?" for short and numeric
 * answers, and records the human-confirmed verdict through POST /api/reviews (practice-only items are not recorded).
 */
export function QuizRunner({ questions, heading, metadata, back, onRestart, restartLabel, summaryExtra }: QuizRunnerProps) {
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [final, setFinal] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  const shownAt = useRef(0);
  const requestId = useRef('');
  const elapsed = useRef(0);

  const question = questions[index] ?? null;

  // A fresh set of questions starts again from the first one.
  useEffect(() => {
    setIndex(0);
    setOutcomes([]);
  }, [questions]);

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
    if (!question || !grade || final === null) return;
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
            generated: question.label.startsWith('Generated'),
            questionType: question.type,
            questionId: question.id,
            grading: grade.method,
            autoVerdict: grade.correct,
            overridden: final !== grade.correct,
            score: Math.round(grade.score * 100) / 100,
            ...metadata(question),
          },
        });
        recorded = true;
      }
      setOutcomes(prev => [...prev, { final, recorded }]);
      setIndex(i => i + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save this answer. Try again.', { variant: 'error' });
    } finally {
      setSaving(false);
    }
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
              <Button onClick={onRestart}>{restartLabel}</Button>
              {summaryExtra}
            </div>
          </div>
        </TerminalPanel>
      </div>
    );
  }

  const isChoice = question.grading === 'exact';
  const total = questions.length;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {back}
      <div className="flex items-center justify-between gap-3 font-mono text-xs text-ink-dim">
        <span className="min-w-0 truncate">{heading}</span>
        <span aria-live="polite">{index + 1} / {total}</span>
      </div>
      <div role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index} className="h-1.5 overflow-hidden rounded bg-panel-hi">
        <div className="h-full bg-magenta transition-[width]" style={{ width: `${(index / total) * 100}%` }} />
      </div>

      <TerminalPanel title={`QUESTION_${String(index + 1).padStart(2, '0')}.EXE`}>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="sm">{TYPE_LABEL[question.type]}</Badge>
            {question.subject && <Badge size="sm" variant="info">{question.subject}</Badge>}
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
