import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMixedTest, interleave, orderVariantTypes, selectWeighted, weightOf, type MixedConcept } from '../src/domain/assessment/mixed.ts';
import { makeRng } from '../src/domain/assessment/random.ts';
import type { PoolEntry, TermInput } from '../src/domain/assessment/types.ts';

const DEFS: Record<string, string> = {
  Normalization: 'Normalization is the process of organizing the columns and tables of a relational database to minimize data redundancy.',
  'Functional dependency': 'A functional dependency is a constraint between two sets of attributes in a relation of the database.',
  'Candidate key': 'Candidate key refers to a minimal set of attributes that uniquely identifies every tuple in a relation.',
  'First Normal Form (1NF)': 'First Normal Form (1NF) is a property of a relation in which every attribute holds only atomic values.',
  Anomaly: 'Anomaly: an update, insertion or deletion problem caused by redundant data in a table of the database.',
};
const pool: PoolEntry[] = Object.entries(DEFS).map(([term, definition]) => ({ term, definition }));
const termInput = (term: string, i: number): TermInput => ({ termId: `t${i}`, conceptId: `c${i}`, term, definition: DEFS[term], sectionId: 's', location: { page: 1 } });

const concept = (id: string, subject: string, probability: number, lapseCount = 0, term: TermInput | null = null): MixedConcept =>
  ({ conceptId: id, subject, topic: null, probability, lapseCount, prompt: `Prompt ${id}`, answer: `Answer ${id}`, term });

test('weight rises as predicted recall falls and as lapses grow, and never hits zero', () => {
  assert.ok(weightOf({ probability: 0.2, lapseCount: 0 }) > weightOf({ probability: 0.9, lapseCount: 0 }));
  assert.ok(weightOf({ probability: 0.6, lapseCount: 3 }) > weightOf({ probability: 0.6, lapseCount: 0 }));
  assert.ok(weightOf({ probability: 1, lapseCount: 0 }) > 0);
  assert.equal(weightOf({ probability: 0.5, lapseCount: 100 }), weightOf({ probability: 0.5, lapseCount: 6 }), 'lapses are capped');
});

test('weighted selection favours weak concepts but is not a hard cut-off', () => {
  const items = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `weak${i}`, p: 0.2 })),
    ...Array.from({ length: 20 }, (_, i) => ({ id: `strong${i}`, p: 0.95 })),
  ];
  let weak = 0, strong = 0;
  for (let seed = 1; seed <= 200; seed++) {
    for (const x of selectWeighted(items, i => weightOf({ probability: i.p, lapseCount: 0 }), 10, makeRng(seed))) x.id.startsWith('weak') ? weak++ : strong++;
  }
  assert.ok(weak > strong * 3, `weak ${weak} vs strong ${strong}`);
  assert.ok(strong > 0, 'strong concepts still appear sometimes');
});

test('selection takes at most `size`, never repeats, and is reproducible for a seed', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: i, p: 0.5 }));
  const pick = (seed: number) => selectWeighted(items, () => 1, 5, makeRng(seed)).map(x => x.id);
  assert.equal(pick(1).length, 5);
  assert.equal(new Set(pick(1)).size, 5);
  assert.deepEqual(pick(1), pick(1));
  assert.notDeepEqual(pick(1), pick(2));
  assert.equal(selectWeighted(items, () => 1, 50, makeRng(1)).length, 12);
});

test('interleave: no more than two in a row from one subject when another is available', () => {
  const items = ['A', 'A', 'A', 'A', 'B', 'B', 'C'].map((s, i) => ({ s, i }));
  const out = interleave(items, x => x.s);
  assert.equal(out.length, items.length);
  assert.deepEqual([...out].sort((a, b) => a.i - b.i), items, 'same items, only reordered');
  for (let i = 2; i < out.length; i++) {
    if (i < 6) assert.ok(!(out[i].s === out[i - 1].s && out[i].s === out[i - 2].s), `run at ${i}: ${out.map(x => x.s).join('')}`);
  }
});

test('interleave: a single subject is left alone', () => {
  const items = ['A', 'A', 'A'].map((s, i) => ({ s, i }));
  assert.deepEqual(interleave(items, x => x.s).map(x => x.i), [0, 1, 2]);
});

test('variant types: the type used longest ago (or never) comes first', () => {
  const all = ['definition', 'cloze', 'mcq', 'truefalse'] as const;
  const rng = () => 0.5;
  assert.equal(orderVariantTypes(['cloze', 'mcq', 'definition'], [...all], rng)[0], 'truefalse', 'never used wins');
  assert.equal(orderVariantTypes(['cloze', 'mcq', 'definition', 'truefalse'], [...all], rng)[0], 'truefalse', 'oldest wins');
  assert.equal(orderVariantTypes(['truefalse', 'definition'], [...all], rng).at(-1), 'truefalse', 'most recent last');
});

test('a mixed test spans subjects, leans to weak concepts and never repeats a concept', () => {
  const concepts: MixedConcept[] = [
    ...Array.from({ length: 8 }, (_, i) => concept(`db${i}`, 'DBMS', 0.3)),
    ...Array.from({ length: 8 }, (_, i) => concept(`ph${i}`, 'Physics', 0.4)),
    ...Array.from({ length: 8 }, (_, i) => concept(`ch${i}`, 'Chem', 0.9)),
  ];
  const test10 = buildMixedTest({ concepts, pools: {}, recentTypes: {}, size: 10, seed: 3 });
  assert.equal(test10.length, 10);
  assert.equal(new Set(test10.map(q => q.conceptId)).size, 10);
  assert.ok(new Set(test10.map(q => q.subject)).size >= 2);
  for (let i = 2; i < test10.length; i++) assert.ok(!(test10[i].subject === test10[i - 1].subject && test10[i].subject === test10[i - 2].subject), 'interleaved');
  assert.ok(test10.every(q => q.type === 'recall' && q.label === 'Written by you' && q.practiceOnly === false));
});

test('a sourced concept gets a generated item, and a different type than the one it last got', () => {
  const concepts = Object.keys(DEFS).map((t, i) => concept(`c${i}`, 'DBMS', 0.4, 0, termInput(t, i)));
  const typesFor = (recent: Record<string, string[]>) =>
    Object.fromEntries(buildMixedTest({ concepts, pools: { DBMS: pool }, recentTypes: recent, size: 5, seed: 9 }).map(q => [q.conceptId as string, q.type as string]));
  const fresh = typesFor({});
  assert.ok(Object.values(fresh).every(t => t !== 'recall'), 'generated, not the plain prompt');
  const avoid = typesFor(Object.fromEntries(Object.entries(fresh).map(([id, t]): [string, string[]] => [id, [t]])));
  let different = 0;
  for (const id of Object.keys(fresh)) if (avoid[id] !== fresh[id]) different++;
  assert.equal(different, 5, `every concept switched type: ${JSON.stringify({ fresh, avoid })}`);
});

test('the same concept gets different items with different seeds (new blank / new wording)', () => {
  const c = concept('c0', 'DBMS', 0.3, 0, termInput('Normalization', 0));
  const prompts = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) prompts.add(buildMixedTest({ concepts: [c], pools: { DBMS: pool }, recentTypes: {}, size: 1, seed })[0].prompt);
  assert.ok(prompts.size >= 3, `only ${prompts.size} distinct prompts`);
});

test('a sourced concept with no usable term falls back to the user\'s own prompt', () => {
  const broken = termInput('Normalization', 0);
  const out = buildMixedTest({ concepts: [concept('x', 'DBMS', 0.3, 0, { ...broken, definition: 'Too short.' })], pools: {}, recentTypes: {}, size: 1, seed: 1 });
  assert.equal(out[0].type, 'recall');
});

test('mixed items carry subject, predicted recall and lapses for the UI', () => {
  const [q] = buildMixedTest({ concepts: [concept('a', 'DBMS', 0.42, 3)], pools: {}, recentTypes: {}, size: 1, seed: 1 });
  assert.deepEqual([q.subject, q.predictedRecall, q.lapseCount, q.conceptId], ['DBMS', 0.42, 3, 'a']);
});
