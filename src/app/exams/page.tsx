'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Exam, ExamPlanResponse } from '@/types';
import { Badge, Button, Dialog, EmptyState, Input, Skeleton, TerminalPanel, useToast } from '@/components/ui';

const KIND_LABEL = { learn: 'LEARN', review: 'REVIEW', mock: 'MOCK TEST' } as const;
const KIND_COLOR = { learn: 'text-cyan border-cyan/50', review: 'text-magenta border-magenta/50', mock: 'text-watch border-watch/50' } as const;

const today = () => new Date().toISOString().slice(0, 10);
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const pct = (p: number) => `${Math.round(p * 100)}%`;

function daysLabel(n: number): string {
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} ago`;
  if (n === 0) return 'today';
  return `${n} day${n === 1 ? '' : 's'} left`;
}

function PlanView({ data }: { data: ExamPlanResponse }) {
  const { plan } = data;
  const atRisk = plan.topics.slice(0, 6);
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-dim">Syllabus coverage</p>
        {plan.coverage.percent === null ? (
          <p className="text-sm text-ink-dim">No syllabus yet. Upload sources for this subject and their sections become the topics.</p>
        ) : (
          <div className="flex items-center gap-3">
            <div role="meter" aria-label="Syllabus coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={plan.coverage.percent} className="h-2 flex-1 overflow-hidden rounded bg-panel-hi">
              <div className="h-full bg-cyan" style={{ width: `${plan.coverage.percent}%` }} />
            </div>
            <span className="font-mono text-sm text-ink">{plan.coverage.percent}%</span>
          </div>
        )}
        {plan.coverage.percent !== null && (
          <p className="text-xs text-ink-dim">{plan.coverage.topicsCovered} of {plan.coverage.topicsTotal} topics have at least one concept.</p>
        )}
      </div>

      {plan.warnings.length > 0 && (
        <ul className="space-y-2" aria-label="Warnings">
          {plan.warnings.map(w => <li key={w} role="status" className="rounded border border-watch/40 bg-watch/10 p-3 text-sm text-watch">{w}</li>)}
        </ul>
      )}

      {atRisk.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-dim">Riskiest topics</p>
          <ul className="space-y-1.5">
            {atRisk.map(t => (
              <li key={`${t.key}-${t.sectionId}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                <span className="min-w-0 break-words text-ink">{t.key}</span>
                <span className={cn('font-mono text-[11px]', t.covered ? 'text-ink-dim' : 'text-watch')}>
                  {t.covered ? `${t.concepts} concept${t.concepts === 1 ? '' : 's'} · predicted ${t.meanRecallAtExam !== null ? pct(t.meanRecallAtExam) : '?'} on exam day` : 'no concepts yet'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-mono text-[11px] text-ink-dim">Predicted recall is an estimate that assumes no further review.</p>
        </div>
      )}

      {plan.days.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-dim">Day by day</p>
          <ol className="space-y-2">
            {plan.days.map((d, i) => (
              <li key={d.date} className="rounded-lg border border-line bg-panel/60">
                <details open={i < 3}>
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="text-sm font-semibold text-ink">{weekday(d.date)}</span>
                    <span className="font-mono text-[11px] text-ink-dim">{d.daysToExam} day{d.daysToExam === 1 ? '' : 's'} before · {d.tasks.length} task{d.tasks.length === 1 ? '' : 's'}</span>
                    {d.estimatedReviews > 0 && <span className="font-mono text-[11px] text-ink-dim">~{d.estimatedReviews} reviews</span>}
                    {d.overloaded && <Badge size="sm" variant="warning">heavy day</Badge>}
                  </summary>
                  <ul className="space-y-2 border-t border-line px-3 py-3">
                    {d.tasks.length === 0 && <li className="text-sm text-ink-dim">Nothing scheduled: a rest day.</li>}
                    {d.tasks.map((t, j) => (
                      <li key={j} className="flex flex-wrap items-start gap-2 text-sm">
                        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider', KIND_COLOR[t.kind])}>{KIND_LABEL[t.kind]}</span>
                        <span className="min-w-0 flex-1 break-words text-ink-dim">
                          {t.note}
                          {t.kind === 'mock' && <> <Link href="/test" className="text-cyan underline-offset-2 hover:underline">Open the mixed test</Link></>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export default function ExamsPage() {
  const toast = useToast();
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [error, setError] = useState('');
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [plans, setPlans] = useState<Record<string, ExamPlanResponse | 'loading' | 'error'>>({});

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ subject: '', name: '', examDate: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Exam | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setExams((await api.exams.list()).exams);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your exams');
    }
  }, []);

  useEffect(() => {
    load();
    Promise.all([api.sources.list().catch(() => ({ sources: [] })), api.rollup().catch(() => ({ subjects: [] }))]).then(([s, r]) =>
      setSubjectOptions([...new Set([...s.sources.map(x => x.subject), ...r.subjects.map(x => x.key)])].sort())
    );
  }, [load]);

  const loadPlan = useCallback(async (id: string) => {
    setPlans(p => ({ ...p, [id]: 'loading' }));
    try {
      const data = await api.exams.plan(id);
      setPlans(p => ({ ...p, [id]: data }));
    } catch {
      setPlans(p => ({ ...p, [id]: 'error' }));
    }
  }, []);

  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    if (next && !plans[next]) loadPlan(next);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.subject.trim()) next.subject = 'Choose or type the subject';
    if (!form.name.trim()) next.name = 'Give the exam a name';
    if (!form.examDate) next.examDate = 'Pick the exam date';
    else if (form.examDate < today()) next.examDate = 'The date is in the past';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const exam = await api.exams.create({ subject: form.subject.trim(), name: form.name.trim(), examDate: form.examDate });
      toast('Exam added', { variant: 'success' });
      setAdding(false);
      setForm({ subject: '', name: '', examDate: '' });
      await load();
      setOpenId(exam.id);
      loadPlan(exam.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the exam', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.exams.delete(deleting.id);
      setExams(prev => (prev ?? []).filter(x => x.id !== deleting.id));
      toast('Exam deleted', { variant: 'success' });
      setDeleting(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the exam', { variant: 'error' });
    } finally {
      setDeleteBusy(false);
    }
  }

  const upcoming = useMemo(() => (exams ?? []).filter(e => e.daysLeft >= 0), [exams]);
  const past = useMemo(() => (exams ?? []).filter(e => e.daysLeft < 0), [exams]);

  const card = (e: Exam) => {
    const plan = plans[e.id];
    return (
      <li key={e.id} className="rounded-lg border border-line bg-panel/85">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-semibold text-ink">{e.name}</p>
            <p className="font-mono text-[11px] text-ink-dim">{e.subject} · {weekday(e.examDate)}</p>
          </div>
          <Badge size="sm" variant={e.daysLeft < 0 ? 'neutral' : e.daysLeft <= 7 ? 'warning' : 'info'}>{daysLabel(e.daysLeft)}</Badge>
          <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-0" aria-expanded={openId === e.id} onClick={() => toggle(e.id)}>
            {openId === e.id ? 'Hide plan' : 'View plan'}
          </Button>
          <button type="button" aria-label={`Delete exam: ${e.name}`} onClick={() => setDeleting(e)} className="flex h-10 w-10 items-center justify-center rounded text-neutral-400 hover:text-due">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {openId === e.id && (
          <div className="border-t border-line p-4">
            {plan === 'loading' || !plan ? (
              <Skeleton className="h-40 w-full" aria-busy="true" />
            ) : plan === 'error' ? (
              <div role="alert" className="space-y-3 text-center">
                <p className="text-sm text-ink-dim">Could not build the plan.</p>
                <Button onClick={() => loadPlan(e.id)}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>
              </div>
            ) : (
              <PlanView data={plan} />
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">// COUNTDOWN</p>
          <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.06em] text-chrome">Exams</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-dim">
            Add an exam date. The sections of your uploaded sources for that subject become the syllabus; the app shows how much of it you have concepts for and plans your revision day by day.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" />Add exam</Button>
      </div>

      {error ? (
        <TerminalPanel title="SIGNAL_LOST.EXE">
          <div role="alert" className="space-y-3 py-4 text-center">
            <p className="text-sm text-ink-dim">{error}</p>
            <Button onClick={load}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>
          </div>
        </TerminalPanel>
      ) : exams === null ? (
        <div className="space-y-3" aria-busy="true">{[0, 1].map(i => <Skeleton key={i} className="h-20" />)}</div>
      ) : exams.length === 0 ? (
        <TerminalPanel title="EMPTY.EXE">
          <EmptyState
            icon={<CalendarDays className="h-12 w-12 text-magenta" aria-hidden="true" />}
            title="No exams yet"
            body="Add the date of an exam and get a revision plan built from what you have uploaded and learned."
            action={<Button onClick={() => setAdding(true)}>Add your first exam</Button>}
          />
        </TerminalPanel>
      ) : (
        <>
          <ul className="space-y-3">{upcoming.map(card)}</ul>
          {past.length > 0 && (
            <section aria-labelledby="past-exams" className="space-y-3">
              <h2 id="past-exams" className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-ink-dim">Past exams</h2>
              <ul className="space-y-3">{past.map(card)}</ul>
            </section>
          )}
        </>
      )}

      <Dialog open={adding} onClose={() => !saving && setAdding(false)} title="NEW_EXAM.EXE">
        <form onSubmit={save} className="space-y-4" noValidate>
          <div>
            <Input label="Subject" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} list="exam-subjects" placeholder="e.g. Databases" error={errors.subject} maxLength={100} />
            <datalist id="exam-subjects">{subjectOptions.map(s => <option key={s} value={s} />)}</datalist>
          </div>
          <Input label="Exam name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mid-term" error={errors.name} maxLength={200} />
          <Input label="Date" type="date" min={today()} value={form.examDate} onChange={e => setForm({ ...form, examDate: e.target.value })} error={errors.examDate} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving}>Add exam</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={() => !deleteBusy && setDeleting(null)}
        title="CONFIRM_DELETE.EXE"
        description="This deletes the exam and its plan. Your sources and concepts are not touched."
        actions={<><Button variant="ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancel</Button><Button variant="danger" onClick={confirmDelete} loading={deleteBusy}>Delete</Button></>}
      >
        <p className="rounded border border-line bg-night p-3 text-sm text-ink">{deleting?.name}</p>
      </Dialog>
    </div>
  );
}
