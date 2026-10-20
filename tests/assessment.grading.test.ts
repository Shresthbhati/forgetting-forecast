import test from 'node:test';
import assert from 'node:assert/strict';
import { editSimilarity, gradeResponse, levenshtein, normalizeAnswer, wordOverlap } from '../src/domain/assessment/grading.ts';
import { computeTopicMastery, MIN_MASTERY_ATTEMPTS } from '../src/domain/assessment/mastery.ts';
import type { Question } from '../src/domain/assessment/types.ts';

const q = (over: Partial<Question>): Question => ({
  id: 'q', type: 'definition', grading: 'short', prompt: 'p', answer: 'a', acceptable: [], explanation: '',
  conceptId: 'c', sectionId: null, location: {}, label: '', practiceOnly: false, ...over,
});

test('normalizeAnswer / levenshtein / editSimilarity', () => {
  assert.equal(normalizeAnswer('  Façade,  Pattern! '), 'facade pattern');
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(editSimilarity('Normalisation', 'normalization') > 0.9, true);
  assert.equal(editSimilarity('abc', 'xyz'), 0);
});

test('multiple choice and true/false are exact matches and need no override', () => {
  const mcq = q({ type: 'mcq', grading: 'exact', answer: 'A minimal set of attributes.' });
  assert.deepEqual([gradeResponse(mcq, 'A minimal set of attributes.').correct, gradeResponse(mcq, 'a minimal set of attributes').correct], [true, true]);
  const wrong = gradeResponse(mcq, 'Something else');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.needsReview, false);
  const tf = q({ type: 'truefalse', grading: 'exact', answer: 'False' });
  assert.equal(gradeResponse(tf, 'false').correct, true);
  assert.equal(gradeResponse(tf, 'True').correct, false);
});

test('short answers: exact, typo and word-overlap paths, always flagged for override', () => {
  const term = q({ answer: 'Candidate key', gradeText: 'Candidate key' });
  const exact = gradeResponse(term, 'candidate key');
  assert.deepEqual([exact.correct, exact.method, exact.needsReview], [true, 'exact', true]);
  const typo = gradeResponse(term, 'candidte key');
  assert.deepEqual([typo.correct, typo.method], [true, 'edit-distance']);
  assert.equal(gradeResponse(term, 'primary key').correct, false);
  assert.equal(gradeResponse(term, 'key').correct, false, 'a missing key word fails a short expected answer');

  const def = q({ gradeText: 'the process of organizing the columns and tables of a relational database to minimize data redundancy' });
  const good = gradeResponse(def, 'organizing tables and columns in a relational database to reduce redundancy of data');
  assert.equal(good.correct, true);
  assert.equal(good.method, 'word-overlap');
  assert.equal(good.needsReview, true);
  assert.equal(gradeResponse(def, 'it makes databases faster').correct, false);
  assert.equal(gradeResponse(def, 'database').correct, false, 'too few words for a long definition');
});

test('short answers tolerate plurals and one-letter typos in key words', () => {
  assert.equal(wordOverlap('minimal set of attributes', 'a minimal sets of attribute'), 1);
  assert.equal(wordOverlap('relational database', 'relationnal databse') > 0.9, true);
});

test('acceptable alternatives are graded too', () => {
  const c = q({ answer: 'First Normal Form', acceptable: ['1NF'] });
  assert.equal(gradeResponse(c, '1nf').correct, true);
});

test('empty responses are wrong and need review only for auto-graded kinds', () => {
  assert.deepEqual([gradeResponse(q({}), '  ').correct, gradeResponse(q({}), ' ').method], [false, 'empty']);
  assert.equal(gradeResponse(q({ grading: 'exact', answer: 'x' }), '').needsReview, false);
});

test('numeric grading: tolerance, formatting and non-numbers', () => {
  const n = q({ type: 'numerical', grading: 'numeric', answer: '12', numeric: { value: 12, tolerance: 0.01 } });
  assert.equal(gradeResponse(n, '12').correct, true);
  assert.equal(gradeResponse(n, '12.0 m/s').correct, true);
  assert.equal(gradeResponse(n, '12.1').correct, true, 'within 1%');
  assert.equal(gradeResponse(n, '13').correct, false);
  assert.equal(gradeResponse(n, 'twelve').correct, false);
  assert.equal(gradeResponse(n, '12').needsReview, true);
  const big = q({ type: 'numerical', grading: 'numeric', answer: '1,200', numeric: { value: 1200, tolerance: 0.01 } });
  assert.equal(gradeResponse(big, '1,200').correct, true);
});

const day = 86_400_000;
const now = new Date('2026-06-01T00:00:00Z');
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * day).toISOString();

test('mastery: per-topic, recency-weighted, null below the minimum sample', () => {
  const concepts = [{ id: 'a', topic: '3.1 Normalization' }, { id: 'b', topic: '3.1 Normalization' }, { id: 'c', topic: '3.2 Keys' }, { id: 'd', topic: null }];
  const attempts = [
    ...[0, 1, 2, 3, 4].map(d => ({ conceptId: 'a', correct: true, answeredAt: at(d) })),
    { conceptId: 'c', correct: true, answeredAt: at(1) },
    { conceptId: 'c', correct: false, answeredAt: at(2) },
    { conceptId: 'zzz', correct: true, answeredAt: at(1) },
  ];
  const rows = computeTopicMastery(concepts, attempts, now);
  const norm = rows.find(r => r.topic === '3.1 Normalization')!;
  assert.deepEqual([norm.concepts, norm.attempts, norm.correct, norm.mastery, norm.insufficientData], [2, 5, 5, 1, false]);
  const keys = rows.find(r => r.topic === '3.2 Keys')!;
  assert.deepEqual([keys.attempts, keys.mastery, keys.insufficientData], [2, null, true]);
  assert.ok(rows.some(r => r.topic === '(no topic)'));
  assert.ok(2 < MIN_MASTERY_ATTEMPTS);
  assert.equal(rows.reduce((n, r) => n + r.attempts, 0), 7, 'attempts for unknown concepts are ignored');
});

test('mastery: recent results weigh more than old ones', () => {
  const concepts = [{ id: 'a', topic: 'T' }];
  const oldWrongNewRight = [0, 1, 2].map(d => ({ conceptId: 'a', correct: true, answeredAt: at(d) })).concat([60, 61, 62].map(d => ({ conceptId: 'a', correct: false, answeredAt: at(d) })));
  const oldRightNewWrong = [0, 1, 2].map(d => ({ conceptId: 'a', correct: false, answeredAt: at(d) })).concat([60, 61, 62].map(d => ({ conceptId: 'a', correct: true, answeredAt: at(d) })));
  const a = computeTopicMastery(concepts, oldWrongNewRight, now)[0].mastery!;
  const b = computeTopicMastery(concepts, oldRightNewWrong, now)[0].mastery!;
  assert.ok(a > 0.5 && b < 0.5, `${a} ${b}`);
});
