/**
 * Application service: exams, syllabus coverage and the revision plan.
 * The syllabus is the sections of the user's ready sources for the exam's subject; coverage is the share of those
 * sections with at least one concept; predicted recall on exam day comes from the same forecast engine as everywhere else.
 */

import { buildRevisionPlan, type ExamTopic } from '@/domain/knowledge/exam';
import { calculateRecallProbability } from '@/domain/forecasting/engine';
import { NotFoundError } from '@/server/errors';
import * as examsRepo from '@/server/repositories/exams';
import { getDailyGoal } from '@/server/repositories/profile';
import * as sources from '@/server/repositories/sources';
import { getConceptsWithForecasts } from '@/server/services/forecasting';
import type { Exam, ExamPlanResponse, UUID } from '@/types';
import type { CreateExamInput } from '@/server/validation/schemas';

const OTHER = '(concepts not tied to a section)';

export const listUserExams = (): Promise<Exam[]> => examsRepo.listExams();
export const createExam = (input: CreateExamInput): Promise<Exam> => examsRepo.insertExam(input);

export async function deleteUserExam(id: UUID): Promise<void> {
  if (!(await examsRepo.getExam(id))) throw new NotFoundError('Exam');
  await examsRepo.deleteExam(id);
}

export async function getExamPlan(id: UUID): Promise<ExamPlanResponse> {
  const exam = await examsRepo.getExam(id);
  if (!exam) throw new NotFoundError('Exam');

  const [allSources, rows, dailyGoal] = await Promise.all([sources.listSources(), getConceptsWithForecasts(), getDailyGoal()]);
  const ready = allSources.filter(s => s.subject === exam.subject && s.status === 'ready');
  const sectionLists = await Promise.all(ready.map(async s => ({ source: s, sections: await sources.listSections(s.id) })));

  const examAt = new Date(`${exam.examDate}T00:00:00Z`);
  const inSubject = rows.filter(r => r.concept.subject === exam.subject);
  // Predicted recall on exam day assuming no further review: the cost of doing nothing.
  const atExam = (r: (typeof inSubject)[number]) => calculateRecallProbability(r.concept, r.recallState, examAt);

  const claimed = new Set<string>();
  const topics: ExamTopic[] = [];
  for (const { source, sections } of sectionLists) {
    for (const section of sections) {
      const mine = inSubject.filter(r => r.concept.sourceSectionId === section.id || (r.concept.sourceId === source.id && r.concept.topic === section.heading));
      mine.forEach(r => claimed.add(r.concept.id));
      topics.push({
        key: section.heading,
        sectionId: section.id,
        sourceTitle: source.title,
        concepts: mine.length,
        meanRecallAtExam: mine.length ? mine.reduce((s, r) => s + atExam(r), 0) / mine.length : null,
      });
    }
  }
  // Concepts the user wrote by hand (or whose source/section was deleted) still count towards the exam.
  const loose = inSubject.filter(r => !claimed.has(r.concept.id));
  if (loose.length) {
    topics.push({ key: OTHER, sectionId: null, sourceTitle: null, concepts: loose.length, meanRecallAtExam: loose.reduce((s, r) => s + atExam(r), 0) / loose.length });
  }

  return { exam, plan: buildRevisionPlan({ examDate: exam.examDate, now: new Date(), topics, dailyGoal }) };
}
