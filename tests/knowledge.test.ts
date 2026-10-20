import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrerequisiteEdges, prerequisiteReport, prerequisitesOf, dependentsOf, type GraphTerm } from '../src/domain/knowledge/graph.ts';

const t = (id: string, term: string, definition: string | null, sectionOrdinal: number): GraphTerm => ({ id, term, definition, sectionOrdinal });

const DBMS: GraphTerm[] = [
  t('tuple', 'Tuple', 'A tuple is a single row of values in a relation of a database.', 0),
  t('attr', 'Attribute', 'An attribute is a named column that holds one value for every tuple in a relation.', 0),
  t('key', 'Candidate key', 'Candidate key refers to a minimal set of attributes that uniquely identifies every tuple in a relation.', 1),
  t('fd', 'Functional dependency', 'A functional dependency is a constraint between two sets of attributes in a relation of the database.', 1),
  t('1nf', 'First Normal Form (1NF)', 'First Normal Form (1NF) is a property of a relation in which every attribute holds only atomic values.', 2),
  t('2nf', 'Second Normal Form (2NF)', 'Second Normal Form (2NF) is a relation in first normal form where every attribute depends on the whole candidate key.', 3),
  t('freq', 'normal form', null, 2),
];

test('A is a prerequisite of B when A is named in B\'s definition and defined no later', () => {
  const edges = buildPrerequisiteEdges(DBMS);
  assert.deepEqual(prerequisitesOf(edges, 'key').sort(), ['attr', 'tuple']);
  assert.deepEqual(prerequisitesOf(edges, 'fd'), ['attr']);
  assert.deepEqual(prerequisitesOf(edges, '1nf'), ['attr']);
  assert.deepEqual(prerequisitesOf(edges, '2nf').sort(), ['1nf', 'attr', 'key']);
  assert.deepEqual(prerequisitesOf(edges, 'tuple'), []);
});

test('a term defined LATER than the one mentioning it is not a prerequisite', () => {
  const terms = [t('a', 'Alpha', 'Alpha is a thing that depends on the beta of the system.', 0), t('b', 'Beta', 'Beta is the underlying part of every system built here.', 2)];
  assert.deepEqual(buildPrerequisiteEdges(terms), []);
});

test('mutual mentions in one section are ambiguous, so neither edge is kept', () => {
  const terms = [t('a', 'Alpha', 'Alpha is a thing that relies on the beta of the system.', 1), t('b', 'Beta', 'Beta is the part that supports every alpha of the system.', 1)];
  assert.deepEqual(buildPrerequisiteEdges(terms), []);
});

test('mutual mentions across sections keep only the forward direction', () => {
  const terms = [t('a', 'Alpha', 'Alpha is a thing that relies on the beta of the system.', 1), t('b', 'Beta', 'Beta is the part that supports every alpha of the system.', 2)];
  assert.deepEqual(buildPrerequisiteEdges(terms), [{ from: 'a', to: 'b' }], 'Alpha (earlier) is the prerequisite of Beta (later)');
});

test('a term never depends on itself, and a shorter name inside a longer matched name does not count twice', () => {
  const terms = [
    t('k', 'Key', 'A key is something that identifies a row in a table of data.', 0),
    t('ck', 'Candidate key', 'Candidate key refers to a minimal key that uniquely identifies every tuple in a relation.', 0),
    t('x', 'Composite', 'Composite is built from a candidate key spanning several columns of a table.', 1),
  ];
  const edges = buildPrerequisiteEdges(terms);
  assert.deepEqual(prerequisitesOf(edges, 'x'), ['ck'], '"key" is inside the matched "candidate key"');
  assert.ok(!edges.some(e => e.from === e.to));
});

test('only defined terms take part: a frequency-picked phrase has no definition to mention', () => {
  const edges = buildPrerequisiteEdges(DBMS);
  assert.ok(!edges.some(e => e.from === 'freq' || e.to === 'freq'));
});

test('dependents are counted', () => {
  const edges = buildPrerequisiteEdges(DBMS);
  assert.ok(dependentsOf(edges, 'attr').length >= 3);
});

test('report: a struggling concept lists prerequisites that need a check, weakest first, with reasons', () => {
  const report = prerequisiteReport({
    termId: '2nf', terms: DBMS, target: 0.8,
    statuses: {
      '2nf': { conceptId: 'c2', probability: 0.4, lapseCount: 1, repetitionCount: 3 },
      '1nf': { conceptId: 'c1', probability: 0.55, lapseCount: 0, repetitionCount: 2 },
      key: { conceptId: 'ck', probability: 0.95, lapseCount: 0, repetitionCount: 4 },
    },
  });
  assert.equal(report.struggling, true);
  assert.deepEqual(report.prerequisites.map(p => p.term), ['Attribute', 'First Normal Form (1NF)', 'Candidate key']);
  assert.match(report.prerequisites[0].reason!, /Not a concept yet/);
  assert.match(report.prerequisites[1].reason!, /55% is below your 80% target/);
  assert.equal(report.prerequisites[2].needsCheck, false);
  assert.equal(report.prerequisites[2].reason, null);
});

test('report: lapses and never-reviewed prerequisites are flagged; a healthy concept is not "struggling"', () => {
  const report = prerequisiteReport({
    termId: 'key', terms: DBMS, target: 0.8,
    statuses: {
      key: { conceptId: 'ck', probability: 0.9, lapseCount: 0, repetitionCount: 5 },
      tuple: { conceptId: 'ct', probability: 0.9, lapseCount: 2, repetitionCount: 5 },
      attr: { conceptId: 'ca', probability: 0.5, lapseCount: 0, repetitionCount: 0 },
    },
  });
  assert.equal(report.struggling, false);
  const byTerm = Object.fromEntries(report.prerequisites.map(p => [p.term, p.reason]));
  assert.match(byTerm.Tuple!, /Lapsed 2 times/);
  assert.match(byTerm.Attribute!, /Never reviewed/);
});
