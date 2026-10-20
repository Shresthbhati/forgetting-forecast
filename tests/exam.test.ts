import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRevisionPlan, daysUntil, type ExamTopic } from '../src/domain/knowledge/exam.ts';

const now = new Date('2026-06-01T15:30:00Z');
const topic = (key: string, concepts: number, recall: number | null): ExamTopic => ({ key, sectionId: `s-${key}`, sourceTitle: 'Notes', concepts, meanRecallAtExam: recall });
const plan = (examDate: string, topics: ExamTopic[], dailyGoal = 20) => buildRevisionPlan({ examDate, now, topics, dailyGoal });

test('daysUntil counts calendar days in UTC, ignoring the time of day', () => {
  assert.equal(daysUntil('2026-06-11', now), 10);
  assert.equal(daysUntil('2026-06-01', now), 0);
  assert.equal(daysUntil('2026-05-30', now), -2);
});

test('past or same-day exams get no plan days and say why', () => {
  const past = plan('2026-05-20', [topic('A', 3, 0.5)]);
  assert.deepEqual([past.status, past.days.length], ['past', 0]);
  assert.match(past.warnings.join(' '), /passed/);
  const today = plan('2026-06-01', [topic('A', 3, 0.5)]);
  assert.deepEqual([today.status, today.days.length], ['today', 0]);
});

test('no topics: empty plan except the mock test, with a warning', () => {
  const p = plan('2026-06-08', []);
  assert.equal(p.coverage.percent, null);
  assert.match(p.warnings.join(' '), /No syllabus/);
  assert.equal(p.days.length, 7);
  assert.equal(p.days.at(-1)!.tasks[0].kind, 'mock');
});

test('coverage counts topics that have at least one concept', () => {
  const p = plan('2026-06-11', [topic('A', 4, 0.9), topic('B', 0, null), topic('C', 2, 0.4), topic('D', 0, null)]);
  assert.deepEqual(p.coverage, { topicsTotal: 4, topicsCovered: 2, percent: 50 });
});

test('topics are ranked by risk: uncovered first, then the weakest predicted recall', () => {
  const p = plan('2026-06-11', [topic('Strong', 5, 0.95), topic('Weak', 5, 0.3), topic('New', 0, null), topic('Mid', 5, 0.7)]);
  assert.deepEqual(p.topics.map(t => t.key), ['New', 'Weak', 'Mid', 'Strong']);
  assert.equal(p.topics[0].risk, 1);
});

test('one plan day per day before the exam, dated from today, and nothing on or after exam day', () => {
  const p = plan('2026-06-11', [topic('A', 3, 0.6)]);
  assert.equal(p.days.length, 10);
  assert.equal(p.days[0].date, '2026-06-01');
  assert.equal(p.days.at(-1)!.date, '2026-06-10');
  assert.deepEqual(p.days.map(d => d.daysToExam), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});

test('the last day is a mock test, and no review is scheduled on it when there are other days', () => {
  const p = plan('2026-06-11', [topic('A', 3, 0.2), topic('B', 3, 0.3)]);
  const last = p.days.at(-1)!;
  assert.deepEqual(last.tasks.map(t => t.kind), ['mock']);
});

test('uncovered topics get a learn task inside the first 60% of the days, each exactly once, then a later review', () => {
  const topics = [topic('U1', 0, null), topic('U2', 0, null), topic('U3', 0, null)];
  const p = plan('2026-06-11', topics); // 10 days, window = 6
  const learnDays = new Map<string, number>();
  p.days.forEach((d, i) => d.tasks.filter(t => t.kind === 'learn').forEach(t => learnDays.set(t.topic!, i)));
  assert.equal(learnDays.size, 3);
  for (const day of learnDays.values()) assert.ok(day < 6, `learn on day ${day}`);
  assert.equal(new Set(learnDays.values()).size, 3, 'spread out, not piled on one day');
  for (const [key, day] of learnDays) {
    const reviewDay = p.days.findIndex(d => d.tasks.some(t => t.kind === 'review' && t.topic === key));
    assert.ok(reviewDay > day, `${key} reviewed (${reviewDay}) after it is learned (${day})`);
  }
});

test('weak covered topics get more review sessions than strong ones, spaced across the days', () => {
  const p = plan('2026-06-21', [topic('Weak', 6, 0.2), topic('Mid', 6, 0.65), topic('Strong', 6, 0.95)]); // 20 days
  const sessions = (key: string) => p.days.flatMap((d, i) => d.tasks.filter(t => t.kind === 'review' && t.topic === key).map(() => i));
  assert.equal(sessions('Weak').length, 3);
  assert.equal(sessions('Mid').length, 2);
  assert.equal(sessions('Strong').length, 1);
  const weak = sessions('Weak');
  assert.deepEqual([...weak].sort((a, b) => a - b), weak, 'in order');
  assert.ok(weak[1] - weak[0] >= 3 && weak[2] - weak[1] >= 3, `spaced: ${weak}`);
  assert.ok(weak.every(i => i < 19));
});

test('a topic is never reviewed twice on the same day', () => {
  const p = plan('2026-06-04', [topic('Weak', 6, 0.1), topic('Other', 2, 0.1)]); // 3 days: sessions collide and are merged
  for (const d of p.days) {
    const keys = d.tasks.filter(t => t.kind === 'review').map(t => t.topic);
    assert.equal(new Set(keys).size, keys.length);
  }
});

test('a one-day plan is just the mock test', () => {
  const p = plan('2026-06-02', [topic('A', 3, 0.5), topic('B', 0, null)]);
  assert.equal(p.days.length, 1);
  assert.ok(p.days[0].tasks.some(t => t.kind === 'mock'));
});

test('overloaded days are flagged against the daily goal, with a warning', () => {
  const heavy = plan('2026-06-04', [topic('Big', 80, 0.2)], 20);
  assert.ok(heavy.days.some(d => d.overloaded));
  assert.match(heavy.warnings.join(' '), /daily goal of 20/);
  const light = plan('2026-06-21', [topic('Big', 12, 0.2)], 20);
  assert.ok(light.days.every(d => !d.overloaded));
});

test('too many uncovered topics for the days left is called out', () => {
  const topics = Array.from({ length: 12 }, (_, i) => topic(`U${i}`, 0, null));
  const p = plan('2026-06-06', topics);
  assert.match(p.warnings.join(' '), /12 topics still have no concepts/);
});
