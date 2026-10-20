import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionError, extractUnits } from '../src/server/ingestion/extract.ts';
import { normalizeUnits } from '../src/domain/ingestion/normalize.ts';
import { segmentUnits } from '../src/domain/ingestion/segment.ts';
import { extractTerms } from '../src/domain/ingestion/terms.ts';
import { DBMS_PAGES } from './fixtures/dbms.ts';
import { makeDocx, makePdf, makePptx } from './fixtures/makeFiles.ts';

const rejects = async (p: Promise<unknown>, pattern: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof ExtractionError && pattern.test(e.message));

test('PDF: one unit per page, page numbers survive extraction', async () => {
  const pages = DBMS_PAGES.map(p => p.replace(/-\n/g, '-').split('\n'));
  const units = await extractUnits('pdf', makePdf(pages));
  assert.equal(units.length, 4);
  assert.deepEqual(units.map(u => u.index), [1, 2, 3, 4]);
  assert.match(units[1].text, /functional dependency is a constraint/i);
  assert.match(units[3].text, /BCNF means/);
  assert.ok(!units[0].text.includes('BCNF means'));
});

test('PDF end to end: sections and definitions keep the right page', async () => {
  const pages = DBMS_PAGES.map(p => p.replace(/-\n/g, '').split('\n'));
  const units = normalizeUnits(await extractUnits('pdf', makePdf(pages)), { stripRepeated: true });
  const sections = segmentUnits(units, 'pdf', 'DBMS');
  assert.deepEqual(sections.map(s => s.location), [{ page: 1 }, { page: 2 }, { page: 3 }, { page: 4 }]);
  const terms = extractTerms(sections);
  const bcnf = terms.find(t => t.term === 'BCNF');
  assert.ok(bcnf, 'BCNF term missing');
  assert.deepEqual(bcnf.location, { page: 4 });
});

test('PDF with no text layer is rejected with the OCR message', async () => {
  await rejects(extractUnits('pdf', makePdf([[''], ['']])), /No text layer — OCR not supported yet/);
});

test('PDF that is not a PDF is a clear error, not a crash', async () => {
  await rejects(extractUnits('pdf', new TextEncoder().encode('%PDF-1.4 garbage')), /Could not read this PDF/);
});

test('PDF over the page limit is rejected', async () => {
  const many = Array.from({ length: 301 }, (_, i) => [`Page ${i} has enough words to count as readable text here.`]);
  await rejects(extractUnits('pdf', makePdf(many)), /limit is 300/);
});

test('DOCX: headings become markdown headings and body text is kept', async () => {
  const bytes = await makeDocx([
    { text: 'Normalization', heading: 1 },
    { text: 'Normalization is the process of organizing data to minimize redundancy in tables.' },
    { text: 'Keys & Anomalies <basics>', heading: 2 },
    { text: 'A candidate key refers to a minimal set of attributes that identifies a row.' },
  ]);
  const [unit, ...rest] = await extractUnits('docx', bytes);
  assert.equal(rest.length, 0);
  assert.match(unit.text, /^# Normalization$/m);
  assert.match(unit.text, /^## Keys & Anomalies <basics>$/m);
  const sections = segmentUnits(normalizeUnits([unit], { stripRepeated: false }), 'docx', 'Doc');
  assert.ok(sections.some(s => s.heading === 'Normalization' || s.text.includes('Normalization is the process')));
  assert.deepEqual(sections[0].location, {});
});

test('DOCX that is not a zip is a clear error', async () => {
  await rejects(extractUnits('docx', new TextEncoder().encode('not a docx')), /Could not read this DOCX/);
});

test('PPTX: slide titles and body text, slide numbers in presentation order', async () => {
  const bytes = await makePptx([
    { title: 'Intro to SQL', body: ['SQL is a declarative query language', 'Used with relational databases'] },
    { body: ['A slide with no title but plenty of readable text on it'] },
    { title: 'Joins & Keys', body: ['Inner join keeps matching rows only'] },
  ]);
  const units = await extractUnits('pptx', bytes);
  assert.deepEqual(units.map(u => u.index), [1, 2, 3]);
  assert.deepEqual(units.map(u => u.title), ['Intro to SQL', null, 'Joins & Keys']);
  assert.equal(units[0].text, 'SQL is a declarative query language\nUsed with relational databases');
  assert.ok(!units[0].text.includes('Intro to SQL'));
});

test('PPTX: slide numbers follow presentation order, not file names', async () => {
  const bytes = await makePptx(
    [
      { title: 'First in deck', body: ['stored in slide3.xml with some words'] },
      { title: 'Second in deck', body: ['stored in slide1.xml with some words'] },
      { title: 'Third in deck', body: ['stored in slide2.xml with some words'] },
    ],
    [3, 1, 2]
  );
  const units = await extractUnits('pptx', bytes);
  assert.deepEqual(units.map(u => u.title), ['First in deck', 'Second in deck', 'Third in deck']);
  const sections = segmentUnits(units, 'pptx', 'Deck');
  assert.ok(sections.every(s => 'slide' in s.location || 'slideStart' in s.location));
});

test('PPTX: sections carry slide numbers through to the outline', async () => {
  const long = (s: string) => Array.from({ length: 4 }, (_, i) => `${s} bullet ${i} explaining the idea in enough words to stand alone`);
  const units = await extractUnits('pptx', await makePptx([{ title: 'Alpha', body: long('a') }, { title: 'Beta', body: long('b') }]));
  const sections = segmentUnits(normalizeUnits(units, { stripRepeated: false }), 'pptx', 'Deck');
  assert.deepEqual(sections.map(s => [s.heading, s.location]), [['Alpha', { slide: 1 }], ['Beta', { slide: 2 }]]);
});

test('TXT/MD: UTF-8 text, BOM stripped; invalid UTF-8 rejected', async () => {
  const [unit] = await extractUnits('text', new TextEncoder().encode('﻿# Notes\nPlenty of readable words are in this little markdown file.'));
  assert.ok(unit.text.startsWith('# Notes'));
  await rejects(extractUnits('text', new Uint8Array([0xff, 0xfe, 0xfa, 0x80])), /not valid UTF-8/);
});

test('empty and near-empty files are failures, never successes', async () => {
  await rejects(extractUnits('text', new TextEncoder().encode('   \n  ')), /No readable text/);
  await rejects(extractUnits('docx', await makeDocx([{ text: 'hi' }])), /No readable text/);
});
