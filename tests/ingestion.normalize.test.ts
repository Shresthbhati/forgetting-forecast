import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, normalizeUnits, stripHeadersAndFooters } from '../src/domain/ingestion/normalize.ts';
import { DBMS_PAGES } from './fixtures/dbms.ts';

test('normalizeText rejoins words hyphenated across lines and collapses whitespace', () => {
  assert.equal(normalizeText('well designed schemas are normal-\nized step by step.'), 'well designed schemas are normalized step by step.');
  assert.equal(normalizeText('a   b\t\tc  \r\n\r\n\r\n\r\nd'), 'a b c\n\nd');
  assert.equal(normalizeText('soft­hyphen'), 'softhyphen');
});

test('normalizeText keeps a real hyphen before a capital or digit', () => {
  assert.equal(normalizeText('Boyce-\nCodd'), 'Boyce-\nCodd');
});

test('stripHeadersAndFooters removes lines that repeat on more than half the pages and page numbers', () => {
  const units = DBMS_PAGES.map((text, i) => ({ index: i + 1, text }));
  const out = stripHeadersAndFooters(units);
  for (const unit of out) {
    assert.ok(!unit.text.includes('DBMS Lecture Notes'), `header left on page ${unit.index}`);
    assert.ok(!/^Page \d+$/m.test(unit.text), `page number left on page ${unit.index}`);
  }
  assert.ok(out[0].text.includes('3.1 Normalization'));
});

test('stripHeadersAndFooters masks digits so "Chapter 3 | 12" and "Chapter 3 | 13" match', () => {
  const units = [1, 2, 3, 4].map(i => ({ index: i, text: `Chapter 3 | ${10 + i}\nUnique body line number ${'x'.repeat(i)}` }));
  const out = stripHeadersAndFooters(units);
  assert.ok(out.every(u => !u.text.includes('Chapter 3')));
  assert.ok(out.every(u => u.text.startsWith('Unique body')));
});

test('stripHeadersAndFooters does not treat a repeated line as a header when there are fewer than 3 pages', () => {
  const units = [1, 2].map(i => ({ index: i, text: `Same line\nbody ${i}` }));
  assert.ok(stripHeadersAndFooters(units).every(u => u.text.includes('Same line')));
});

test('stripHeadersAndFooters keeps lines that repeat on half the pages or fewer', () => {
  const units = [
    { index: 1, text: 'Intro line\nbody one' },
    { index: 2, text: 'Intro line\nbody two' },
    { index: 3, text: 'body three' },
    { index: 4, text: 'body four' },
  ];
  assert.ok(stripHeadersAndFooters(units)[0].text.includes('Intro line'));
});

test('normalizeUnits leaves slide text alone when stripRepeated is false', () => {
  const units = [1, 2, 3].map(i => ({ index: i, title: `T${i}`, text: `Agenda\n${i}` }));
  const out = normalizeUnits(units, { stripRepeated: false });
  assert.ok(out.every(u => u.text.includes('Agenda')));
});
