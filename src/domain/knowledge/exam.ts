/**
 * Exam mode: syllabus coverage and a day-by-day revision plan. Pure; dates are plain UTC calendar days.
 *
 * The "syllabus" is the sections (topics) of the user's uploaded sources for the exam's subject. A topic is COVERED
 * once at least one concept has been made from it. The plan:
 *   - spreads "learn" tasks for uncovered topics over the first 60% of the days,
 *   - gives each covered topic 1-3 review sessions, more for topics predicted to be weak on exam day,
 *     spaced across the remaining days (and one review a couple of days after a topic is learned),
 *   - ends with a mixed mock test on the last day before the exam.
 */

export interface ExamTopic {
  key: string;
  sectionId: string | null;
  sourceTitle: string | null;
  /** Concepts made from this topic. */
  concepts: number;
  /** Mean predicted recall on exam day if nothing more is reviewed; null when the topic has no concepts. */
  meanRecallAtExam: number | null;
}

export interface TopicRisk extends ExamTopic {
  /** 0-1; uncovered topics are 1 (nothing is known). */
  risk: number;
  covered: boolean;
}

export interface PlanTask {
  kind: 'learn' | 'review' | 'mock';
  topic?: string;
  sectionId?: string | null;
  concepts?: number;
  note: string;
}

export interface PlanDay {
  date: string;
  daysToExam: number;
  tasks: PlanTask[];
  /** Concept reviews the day's tasks imply (mock tests count as one session's worth). */
  estimatedReviews: number;
  /** More than 1.5 x the daily goal. */
  overloaded: boolean;
}

export interface RevisionPlan {
  examDate: string;
  daysLeft: number;
  status: 'upcoming' | 'today' | 'past';
  coverage: { topicsTotal: number; topicsCovered: number; percent: number | null };
  topics: TopicRisk[];
  days: PlanDay[];
  warnings: string[];
}

export const LEARN_WINDOW_SHARE = 0.6;
export const OVERLOAD_FACTOR = 1.5;
export const MOCK_SIZE = 10;
const DAY_MS = 86_400_000;

export const toDay = (d: Date): string => d.toISOString().slice(0, 10);
const parseDay = (s: string): number => Date.parse(`${s}T00:00:00Z`);

export function daysUntil(examDate: string, now: Date): number {
  return Math.round((parseDay(examDate) - parseDay(toDay(now))) / DAY_MS);
}

const sessionsFor = (risk: number) => (risk > 0.5 ? 3 : risk > 0.25 ? 2 : 1);

export function buildRevisionPlan(input: { examDate: string; now: Date; topics: ExamTopic[]; dailyGoal: number }): RevisionPlan {
  const { examDate, now, dailyGoal } = input;
  const daysLeft = daysUntil(examDate, now);
  const status: RevisionPlan['status'] = daysLeft > 0 ? 'upcoming' : daysLeft === 0 ? 'today' : 'past';

  const topics: TopicRisk[] = input.topics
    .map(t => {
      const covered = t.concepts > 0;
      return { ...t, covered, risk: covered ? Math.round((1 - (t.meanRecallAtExam ?? 0.5)) * 1000) / 1000 : 1 };
    })
    .sort((a, b) => b.risk - a.risk || a.key.localeCompare(b.key));

  const covered = topics.filter(t => t.covered);
  const uncovered = topics.filter(t => !t.covered);
  const coverage = {
    topicsTotal: topics.length,
    topicsCovered: covered.length,
    percent: topics.length === 0 ? null : Math.round((covered.length / topics.length) * 100),
  };

  const warnings: string[] = [];
  if (topics.length === 0) warnings.push('No syllabus yet: upload sources for this subject and their sections become the topics.');
  if (status !== 'upcoming') {
    warnings.push(status === 'today' ? 'The exam is today: no plan days remain.' : 'This exam date has passed.');
    return { examDate, daysLeft, status, coverage, topics, days: [], warnings };
  }

  const n = daysLeft; // plan days: today .. the day before the exam
  const startMs = parseDay(toDay(now));
  const days: PlanDay[] = Array.from({ length: n }, (_, i) => ({
    date: toDay(new Date(startMs + i * DAY_MS)), daysToExam: n - i, tasks: [], estimatedReviews: 0, overloaded: false,
  }));
  const lastReviewDay = Math.max(0, n - 2); // keep the final day for the mock test (when there is more than one day)

  // 1. Learn tasks for uncovered topics, spread evenly over the first 60% of the days.
  const learnWindow = Math.max(1, Math.ceil(n * LEARN_WINDOW_SHARE));
  const learnDay = new Map<string, number>();
  uncovered.forEach((t, j) => {
    const day = Math.min(learnWindow - 1, Math.floor((j * learnWindow) / uncovered.length));
    learnDay.set(t.key, day);
    days[day].tasks.push({
      kind: 'learn', topic: t.key, sectionId: t.sectionId,
      note: `Read “${t.key}”${t.sourceTitle ? ` (${t.sourceTitle})` : ''} and add its key terms as concepts.`,
    });
  });
  if (uncovered.length > learnWindow * 2) {
    warnings.push(`${uncovered.length} topics still have no concepts but there are only ${n} day${n === 1 ? '' : 's'}: some days carry several topics. Start now or narrow the syllabus.`);
  }

  // 2. Review sessions: covered topics by risk, spread across the days; newly learned topics get one a couple of days later.
  const addReview = (topic: TopicRisk | { key: string; sectionId: string | null; concepts: number }, day: number, note: string) => {
    const d = days[Math.min(lastReviewDay, Math.max(0, day))];
    if (d.tasks.some(t => t.kind === 'review' && t.topic === topic.key)) return;
    d.tasks.push({ kind: 'review', topic: topic.key, sectionId: topic.sectionId, concepts: topic.concepts || undefined, note });
  };
  for (const t of covered) {
    const k = Math.min(sessionsFor(t.risk), Math.max(1, lastReviewDay + 1));
    for (let s = 0; s < k; s++) {
      const day = Math.floor(((s + 1) * (lastReviewDay + 1)) / (k + 1));
      addReview(t, day, `Review ${t.concepts} concept${t.concepts === 1 ? '' : 's'} in “${t.key}”${t.meanRecallAtExam !== null ? ` (predicted ${Math.round(t.meanRecallAtExam * 100)}% on exam day without review)` : ''}.`);
    }
  }
  for (const t of uncovered) {
    addReview({ key: t.key, sectionId: t.sectionId, concepts: 0 }, (learnDay.get(t.key) ?? 0) + 2, `Review the concepts you added for “${t.key}”.`);
  }

  // 3. A mixed mock test on the last day before the exam.
  days[n - 1].tasks.push({ kind: 'mock', note: `Mixed test across this subject (about ${MOCK_SIZE} questions), then a light look at anything you got wrong.` });

  for (const d of days) {
    d.estimatedReviews = d.tasks.reduce((s, t) => s + (t.kind === 'review' ? t.concepts ?? 0 : t.kind === 'mock' ? Math.min(MOCK_SIZE, dailyGoal) : 0), 0);
    d.overloaded = d.estimatedReviews > dailyGoal * OVERLOAD_FACTOR;
  }
  const overloaded = days.filter(d => d.overloaded).length;
  if (overloaded > 0) {
    warnings.push(`${overloaded} day${overloaded === 1 ? '' : 's'} need more than ${OVERLOAD_FACTOR}× your daily goal of ${dailyGoal}. Raise the goal in Settings or start earlier.`);
  }
  return { examDate, daysLeft, status, coverage, topics, days, warnings };
}
