import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatePhrases, contextSentence, extractTerms, findDefinitions } from '../src/domain/ingestion/terms.ts';
import { segmentUnits } from '../src/domain/ingestion/segment.ts';
import { normalizeUnits } from '../src/domain/ingestion/normalize.ts';
import { DBMS_PAGES } from './fixtures/dbms.ts';

const defs = (text: string) => findDefinitions(text).map(d => d.term);

test('findDefinitions: X is/are, refers to, is defined as, means', () => {
  assert.deepEqual(defs('Normalization is the process of organizing the columns and tables of a database.'), ['Normalization']);
  assert.deepEqual(defs('Candidate key refers to a minimal set of attributes that identifies every tuple.'), ['Candidate key']);
  assert.deepEqual(defs('A transaction is defined as a logical unit of work performed against a database.'), ['transaction']);
  assert.deepEqual(defs('BCNF means that every determinant of a dependency must be a superkey.'), ['BCNF']);
  assert.deepEqual(defs('Foreign keys are a set of attributes that reference the primary key of another table.'), ['Foreign keys']);
});

test('findDefinitions: colon and dash forms', () => {
  assert.deepEqual(defs('Anomaly: an update, insertion or deletion problem caused by redundant data.'), ['Anomaly']);
  assert.deepEqual(defs('Atomic value — a value that cannot be divided into smaller meaningful parts.'), ['Atomic value']);
  assert.deepEqual(defs('Superkey - any set of attributes that uniquely identifies a row in a table.'), ['Superkey']);
});

test('findDefinitions keeps a parenthesised acronym with the term', () => {
  assert.deepEqual(defs('First Normal Form (1NF) is a property of a relation in which every attribute is atomic.'), ['First Normal Form (1NF)']);
});

test('findDefinitions rejects pronoun stems, labels, questions and plain "is" statements', () => {
  assert.deepEqual(defs('It is the process of organizing the columns and tables of a database.'), []);
  assert.deepEqual(defs('This is a good reason to normalise the tables before querying them.'), []);
  assert.deepEqual(defs('Note: remember to back up the database before running the migration.'), []);
  assert.deepEqual(defs('What is normalization and why is it the process of choice for designers?'), []);
  assert.deepEqual(defs('The query is slow because the table has no index on the join column.'), []);
  assert.deepEqual(defs('Short is a thing.'), []);
});

test('candidatePhrases splits at stopwords and punctuation', () => {
  const phrases = [...candidatePhrases('The functional dependency of the candidate key, and the database.').keys()];
  assert.ok(phrases.includes('functional dependency'));
  assert.ok(phrases.includes('candidate key'));
  assert.ok(phrases.includes('database'));
  assert.ok(!phrases.some(p => p.split(' ').includes('the')));
});

const dbmsSections = () =>
  segmentUnits(normalizeUnits(DBMS_PAGES.map((text, i) => ({ index: i + 1, text })), { stripRepeated: true }), 'pdf', 'DBMS');

test('DBMS fixture: extracts the defined terms with their sentences and page locations', () => {
  const terms = extractTerms(dbmsSections());
  const byName = new Map(terms.map(t => [t.term.toLowerCase(), t]));

  const normalization = byName.get('normalization');
  assert.ok(normalization, 'normalization missing');
  assert.match(normalization.definition ?? '', /^Normalization is the process of organizing/);
  assert.deepEqual(normalization.location, { page: 1 });

  const fd = byName.get('functional dependency');
  assert.ok(fd?.definition?.startsWith('A functional dependency is a constraint'));
  assert.deepEqual(fd?.location, { page: 2 });

  assert.ok(byName.get('candidate key')?.definition?.includes('minimal set of attributes'));
  assert.ok(byName.get('first normal form (1nf)')?.definition?.includes('atomic values'));
  assert.ok(byName.get('atomic value')?.definition?.includes('cannot be divided'));
  assert.ok(byName.get('bcnf')?.definition?.includes('superkey'));
  assert.ok(byName.get('anomaly')?.definition?.includes('redundant data'));
  assert.deepEqual(byName.get('bcnf')?.location, { page: 4 });
});

test('DBMS fixture: non-defined recurring phrases appear as candidates without a definition; stopword junk does not', () => {
  const terms = extractTerms(dbmsSections());
  const names = terms.map(t => t.term.toLowerCase());
  assert.ok(names.includes('normal form'), `got: ${names.join(' | ')}`);
  assert.equal(terms.find(t => t.term.toLowerCase() === 'normal form')?.definition, null);
  assert.ok(!names.some(n => /^(the|a|of|is|this|that)$/.test(n)));
  assert.ok(!names.includes('page'));
  assert.ok(terms.every(t => Number.isFinite(t.score) && t.score > 0));
  assert.deepEqual([...terms].sort((a, b) => b.score - a.score), terms, 'sorted by score');
});

test('extractTerms: terms already common in the subject score lower than rare ones', () => {
  const sections = dbmsSections();
  const plain = extractTerms(sections).find(t => t.term.toLowerCase() === 'normal form')!;
  const common = extractTerms(sections, { externalSections: 40, externalDocFreq: new Map([['normal form', 40]]) }).find(t => t.term.toLowerCase() === 'normal form')!;
  assert.ok(common.score < plain.score);
});

test('extractTerms returns nothing for text with no usable terms', () => {
  assert.deepEqual(extractTerms([]), []);
  assert.deepEqual(extractTerms([{ ordinal: 0, level: 1, heading: 'x', text: 'it is a on of the', location: {} }]), []);
});

test('contextSentence finds the first sentence mentioning a term', () => {
  const text = 'Intro sentence that does not matter at all.\nWe write X -> Y when every value of X determines exactly one value of Y. Functional dependency is key.';
  assert.match(contextSentence(text, 'Functional dependency') ?? '', /Functional dependency is key/);
  assert.equal(contextSentence(text, 'unrelated'), null);
});
