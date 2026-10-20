import test from 'node:test';
import assert from 'node:assert/strict';
import { rollUp, type RollupConcept } from '../src/domain/forecasting/rollup.ts';

const c = (id: string, subject: string, topic: string | null, probability: number, reps = 1, lapses = 0): RollupConcept =>
  ({ id, subject, topic, probability, repetitionCount: reps, lapseCount: lapses });

const data = [
  c('a', 'DBMS', '3.1 Normalization', 0.9),
  c('b', 'DBMS', '3.1 Normalization', 0.5, 2, 1),
  c('c', 'DBMS', '3.2 Keys', 0.7, 0),
  c('d', 'Physics', null, 0.95),
  c('e', 'Physics', null, 0.85, 3),
  c('f', 'DBMS', null, 0.2, 1, 2),
];

test('rolls concepts up to topics and subjects, weakest first', () => {
  const out = rollUp(data, 0.8);
  assert.deepEqual(out.map(s => s.key), ['DBMS', 'Physics']);
  const dbms = out[0];
  assert.equal(dbms.concepts, 4);
  assert.equal(dbms.meanRecall, 0.575); // (0.9+0.5+0.7+0.2)/4
  assert.equal(dbms.atRisk, 3);
  assert.equal(dbms.reviewed, 3);
  assert.equal(dbms.lapses, 3);
  assert.deepEqual(dbms.weakest, { id: 'f', probability: 0.2 });
  assert.deepEqual(dbms.topics.map(t => t.key), ['(no topic)', '3.1 Normalization', '3.2 Keys']);
  const norm = dbms.topics.find(t => t.key === '3.1 Normalization')!;
  assert.equal(norm.meanRecall, 0.7);
  assert.equal(norm.atRisk, 1);
});

test('the subject figure is over all concepts, not a mean of topic means', () => {
  const skewed = [c('1', 'S', 'big', 0.9), c('2', 'S', 'big', 0.9), c('3', 'S', 'big', 0.9), c('4', 'S', 'small', 0.3)];
  const s = rollUp(skewed, 0.8)[0];
  assert.equal(s.meanRecall, 0.75);
  assert.notEqual(s.meanRecall, (0.9 + 0.3) / 2);
});

test('the target decides what is at risk', () => {
  assert.equal(rollUp(data, 0.95)[0].atRisk, 4);
  assert.equal(rollUp(data, 0.5)[0].atRisk, 1);
});

test('no concepts, no rollup', () => assert.deepEqual(rollUp([], 0.8), []));
