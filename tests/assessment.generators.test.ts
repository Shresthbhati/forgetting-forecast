import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQuestions } from '../src/domain/assessment/generators.ts';
import { dedupeQuestions, passesBodyGate, passesStemGate } from '../src/domain/assessment/gates.ts';
import { gradeResponse } from '../src/domain/assessment/grading.ts';
import type { GeneratorInput, PoolEntry, Question, TermInput } from '../src/domain/assessment/types.ts';

const DEFS: Record<string, string> = {
  Normalization: 'Normalization is the process of organizing the columns and tables of a relational database to minimize data redundancy.',
  'Functional dependency': 'A functional dependency is a constraint between two sets of attributes in a relation of the database.',
  'Candidate key': 'Candidate key refers to a minimal set of attributes that uniquely identifies every tuple in a relation.',
  'First Normal Form (1NF)': 'First Normal Form (1NF) is a property of a relation in which every attribute holds only atomic values.',
  Anomaly: 'Anomaly: an update, insertion or deletion problem caused by redundant data in a table of the database.',
  Transaction: 'A transaction is a logical unit of work that is performed against a database and either commits or rolls back.',
};
const pool: PoolEntry[] = Object.entries(DEFS).map(([term, definition]) => ({ term, definition }));
const terms: TermInput[] = Object.entries(DEFS).map(([term, definition], i) => ({
  termId: `t${i}`, conceptId: `c${i}`, term, definition, sectionId: 's1', location: { page: 2 },
}));
const input = (over: Partial<GeneratorInput> = {}): GeneratorInput => ({ terms, pool, formulas: [], seed: 1, ...over });
const only = (type: 'definition' | 'cloze' | 'mcq' | 'truefalse', seed = 1) => generateQuestions(input({ types: [type], seed }));

test('definition recall: "Define: term", graded against the definition body, labelled with its page', () => {
  const qs = only('definition');
  assert.equal(qs.length, terms.length);
  const q = qs.find(x => x.prompt === 'Define: Normalization')!;
  assert.equal(q.type, 'definition');
  assert.equal(q.grading, 'short');
  assert.equal(q.gradeText?.startsWith('the process of organizing'), true);
  assert.equal(q.label, 'Generated from p. 2');
  assert.equal(q.practiceOnly, false);
  assert.equal(q.conceptId, 'c0');
});

test('cloze: the blank replaces the term everywhere and the answer is the term', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    for (const q of only('cloze', seed)) {
      assert.match(q.prompt, /_____/);
      assert.ok(!q.prompt.toLowerCase().includes(q.answer.toLowerCase()), `answer leaked: ${q.prompt} / ${q.answer}`);
      assert.ok(q.explanation.toLowerCase().includes(q.answer.toLowerCase()), 'explanation is the full source sentence');
    }
  }
});

test('cloze: a term with an acronym also accepts the acronym and the full form', () => {
  const q = [1, 2, 3, 4, 5, 6, 7, 8].flatMap(seed => only('cloze', seed)).find(x => x.answer === 'First Normal Form');
  assert.ok(q, 'term-variant cloze for First Normal Form');
  assert.ok(q.acceptable.includes('1NF') && q.acceptable.includes('First Normal Form (1NF)'));
  assert.equal(gradeResponse(q, '1NF').correct, true);
  assert.equal(gradeResponse(q, 'first normal form').correct, true);
});

test('cloze and true/false never leave a term\'s acronym behind in the stem', () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap(seed => [...only('cloze', seed), ...only('truefalse', seed)]);
  const withAcronym = all.filter(q => q.explanation.startsWith('First Normal Form (1NF)'));
  assert.ok(withAcronym.length > 0);
  for (const q of withAcronym.filter(x => x.type === 'cloze' && x.answer === 'First Normal Form')) {
    assert.ok(!/1NF/.test(q.prompt), `acronym leaked: ${q.prompt}`);
    assert.match(q.prompt, /_____ is a property/);
  }
  for (const q of all.filter(x => x.type === 'truefalse' && x.answer === 'False')) assert.ok(!/\(1NF\) is/.test(q.prompt.replace('First Normal Form (1NF)', '')), q.prompt);
});

test('multiple choice: 4 distinct options, correct one present, no distractor names the answer', () => {
  const qs = only('mcq');
  assert.ok(qs.length >= 4);
  for (const q of qs) {
    assert.equal(q.options?.length, 4);
    assert.equal(new Set(q.options!.map(o => o.toLowerCase())).size, 4, 'options are distinct');
    assert.ok(q.options!.includes(q.answer));
    const name = q.prompt.match(/"(.+)"/)![1].toLowerCase();
    for (const o of q.options!) if (o !== q.answer) assert.ok(!o.toLowerCase().includes(name), `distractor leaks "${name}": ${o}`);
    assert.equal(q.grading, 'exact');
  }
});

test('multiple choice: distractors are the closest in length to the correct body', () => {
  const q = only('mcq').find(x => x.prompt.includes('Normalization'))!;
  const lengths = Object.values(DEFS).map(d => d.length);
  assert.ok(lengths.length > 4);
  const bodyLen = (s: string) => s.length;
  const wrong = q.options!.filter(o => o !== q.answer);
  const others = pool.filter(p => p.term !== 'Normalization').map(p => p.definition.length);
  const maxWrongGap = Math.max(...wrong.map(w => Math.abs(bodyLen(w) - bodyLen(q.answer))));
  const worstPossible = Math.max(...others.map(l => Math.abs(l - q.answer.length - 60)));
  assert.ok(maxWrongGap <= worstPossible, 'chosen distractors are not the most different ones');
});

test('multiple choice needs 3 other defined terms in the subject; otherwise the term gets another question type', () => {
  const three = terms.slice(0, 3); // each has only 2 other defined terms in a 3-entry pool
  const small = generateQuestions(input({ terms: three, pool: pool.slice(0, 3), types: ['mcq'] }));
  assert.equal(small.length, 0);
  const mixed = generateQuestions(input({ terms: three, pool: pool.slice(0, 3), types: ['mcq', 'definition'] }));
  assert.equal(mixed.length, 3);
  assert.ok(mixed.every(q => q.type === 'definition'));
});

test('true/false: true statements are the source sentence; false ones swap the term and are marked False', () => {
  const qs = [1, 2, 3, 4, 5, 6, 7, 8].flatMap(seed => only('truefalse', seed));
  const falses = qs.filter(q => q.answer === 'False');
  const trues = qs.filter(q => q.answer === 'True');
  assert.ok(falses.length > 0 && trues.length > 0, 'both kinds are produced across seeds');
  for (const q of trues) assert.equal(q.prompt, `True or false: ${q.explanation}`);
  for (const q of falses) {
    assert.notEqual(q.prompt, `True or false: ${q.explanation}`);
    assert.deepEqual(q.options, ['True', 'False']);
  }
  const f = falses.find(q => q.explanation.startsWith('Normalization'))!;
  if (f) assert.ok(!f.prompt.includes('Normalization is the process'));
});

test('numerical: random values, computed answer, tolerance, practice only', () => {
  const qs = generateQuestions({ terms: [], pool: [], seed: 7, formulas: [{ text: 'Newton: F = m·a. Also E = mc^2.', sectionId: 's2', location: { page: 5 } }] });
  assert.equal(qs.length, 2);
  for (const q of qs) {
    assert.equal(q.type, 'numerical');
    assert.equal(q.practiceOnly, true);
    assert.equal(q.conceptId, null);
    assert.equal(q.grading, 'numeric');
    assert.equal(q.label, 'Generated from p. 5');
  }
  const force = qs.find(q => q.prompt.includes('F = m·a'))!;
  const [m, a] = [/m = (\d+)/.exec(force.prompt)![1], /a = (\d+)/.exec(force.prompt)![1]].map(Number);
  assert.equal(force.answer, String(m * a));
  assert.equal(gradeResponse(force, String(m * a)).correct, true);
  assert.equal(gradeResponse(force, `${m * a} N`).correct, true, 'units after the number are ignored');
  assert.equal(gradeResponse(force, String(m * a + 5)).correct, false);
  const energy = qs.find(q => q.prompt.includes('E = mc^2'))!;
  const [m2, c] = [/m = (\d+)/.exec(energy.prompt)![1], /c = (\d+)/.exec(energy.prompt)![1]].map(Number);
  assert.equal(energy.answer, String(m2 * c * c));
});

test('numerical: different seeds give different numbers; maxNumerical caps the count', () => {
  const f = [{ text: 'F = m·a and v = u + at and E = mc^2', sectionId: 's', location: {} }];
  const a = generateQuestions({ terms: [], pool: [], formulas: f, seed: 1 });
  const b = generateQuestions({ terms: [], pool: [], formulas: f, seed: 2 });
  assert.equal(a.length, 2, 'default cap is 2');
  assert.notDeepEqual(a.map(q => q.prompt).sort(), b.map(q => q.prompt).sort());
  assert.equal(generateQuestions({ terms: [], pool: [], formulas: f, seed: 1, maxNumerical: 3 }).length, 3);
});

test('generation is deterministic for a seed and varies across seeds', () => {
  const prompts = (seed: number) => generateQuestions(input({ seed })).map(q => q.prompt);
  assert.deepEqual(prompts(3), prompts(3));
  assert.notDeepEqual(prompts(3), prompts(4));
});

test('a mixed quiz rotates question types and gives one question per term', () => {
  const qs = generateQuestions(input({ seed: 5 }));
  assert.equal(qs.length, terms.length);
  assert.ok(new Set(qs.map(q => q.type)).size >= 3, `types: ${qs.map(q => q.type)}`);
});

test('terms without a usable definition produce nothing; items without a concept are practice-only', () => {
  assert.equal(generateQuestions(input({ terms: [{ ...terms[0], definition: null }] })).length, 0);
  assert.equal(generateQuestions(input({ terms: [{ ...terms[0], definition: 'Too short.' }] })).length, 0);
  const orphan = generateQuestions(input({ terms: [{ ...terms[0], conceptId: null }], types: ['definition'] }));
  assert.equal(orphan[0].practiceOnly, true);
});

test('quality gates: pronoun-only and too-short stems are rejected, real stems pass', () => {
  assert.equal(passesStemGate('What is it?'), false);
  assert.equal(passesStemGate('_____ is this one.'), false);
  assert.equal(passesStemGate('It is the one that they have.'), false);
  assert.equal(passesStemGate('Short stem'), false);
  assert.equal(passesStemGate('_____ is the process of organizing tables to minimize redundancy.'), true);
  assert.equal(passesStemGate('Which definition matches "Normalization"?'), true);
  assert.equal(passesBodyGate('a thing'), false);
  assert.equal(passesBodyGate('the process of organizing the columns and tables'), true);
});

test('dedupe drops repeated prompts of the same type, keeping the first', () => {
  const q = (type: Question['type'], prompt: string) => ({ ...only('definition')[0], type, prompt });
  const out = dedupeQuestions([q('cloze', 'Same  prompt'), q('cloze', 'same prompt'), q('mcq', 'same prompt')]);
  assert.equal(out.length, 2);
});
