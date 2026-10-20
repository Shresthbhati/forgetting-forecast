import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHeading, segmentUnits, MAX_SECTION_CHARS } from '../src/domain/ingestion/segment.ts';
import { normalizeUnits } from '../src/domain/ingestion/normalize.ts';
import { formatLocation, formatSourceReference } from '../src/domain/ingestion/location.ts';
import { detectKind } from '../src/domain/ingestion/kind.ts';
import { DBMS_PAGES } from './fixtures/dbms.ts';

const dbmsUnits = () => normalizeUnits(DBMS_PAGES.map((text, i) => ({ index: i + 1, text })), { stripRepeated: true });

test('detectHeading: numbered, markdown, all-caps; rejects prose', () => {
  assert.deepEqual(detectHeading('1.2 Functional Dependency'), { level: 2, text: '1.2 Functional Dependency' });
  assert.deepEqual(detectHeading('3 Indexing'), { level: 1, text: '3 Indexing' });
  assert.deepEqual(detectHeading('## Joins'), { level: 2, text: 'Joins' });
  assert.deepEqual(detectHeading('FIRST NORMAL FORM'), { level: 1, text: 'FIRST NORMAL FORM' });
  assert.equal(detectHeading('1. Remember to wash your hands before the test.'), null);
  assert.equal(detectHeading('A functional dependency is a constraint.'), null);
  assert.equal(detectHeading('42'), null);
  assert.equal(detectHeading('OK'), null);
});

test('segmentUnits splits the DBMS notes into sections with page locations', () => {
  const sections = segmentUnits(dbmsUnits(), 'pdf', 'DBMS notes');
  assert.deepEqual(sections.map(s => s.heading), ['3.1 Normalization', '3.2 Functional Dependency', 'FIRST NORMAL FORM', '3.3 Boyce-Codd Normal Form']);
  assert.deepEqual(sections.map(s => s.location), [{ page: 1 }, { page: 2 }, { page: 3 }, { page: 4 }]);
  assert.deepEqual(sections.map(s => s.ordinal), [0, 1, 2, 3]);
  assert.equal(sections[0].level, 2);
  assert.equal(sections[2].level, 1);
});

test('segmentUnits reflows wrapped lines but keeps capitalised lines apart', () => {
  const [first] = segmentUnits(dbmsUnits(), 'pdf', 'x');
  assert.ok(first.text.includes('minimize data redundancy. Redundant data wastes storage'));
  assert.ok(first.text.includes('normalized step by step'));
  assert.ok(first.text.split('\n').some(l => l.startsWith('Anomaly:')));
});

test('segmentUnits uses the fallback heading for text before the first heading', () => {
  const units = [{ index: 1, text: 'Some opening text that has no heading above it at all and is long enough to remain its own section. '.repeat(3) + '\n# Real heading\n' + 'Body of the real section that is also long enough to stay alone. '.repeat(4) }];
  const sections = segmentUnits(units, 'text', 'My notes');
  assert.equal(sections[0].heading, 'My notes');
  assert.equal(sections[1].heading, 'Real heading');
  assert.deepEqual(sections[0].location, {});
});

test('segmentUnits merges tiny sections into their neighbour', () => {
  const body = 'This paragraph is comfortably longer than the minimum section size so it stands alone. '.repeat(4);
  const sections = segmentUnits([{ index: 1, text: `# Big\n${body}\n# Tiny\nshort line\n# Next\n${body}` }], 'text', 'x');
  assert.deepEqual(sections.map(s => s.heading), ['Big', 'Next']);
  assert.ok(sections[0].text.includes('Tiny') && sections[0].text.includes('short line'));
});

test('segmentUnits caps oversized sections and records the page range of each part', () => {
  const line = 'Sentence that fills the page with plausible study material for the cap test. ';
  const pages = [1, 2, 3].map(i => ({ index: i, text: (line.repeat(25) + '\n').repeat(2) }));
  const sections = segmentUnits(pages, 'pdf', 'Long');
  assert.ok(sections.length >= 2);
  for (const s of sections) assert.ok(s.text.length <= MAX_SECTION_CHARS + 200, `section too large: ${s.text.length}`);
  assert.ok(sections[1].heading.includes('(part 2)'));
  assert.ok(sections.every(s => 'page' in s.location || 'pageStart' in s.location));
});

test('segmentUnits makes one section per slide titled by the slide title and records slide numbers', () => {
  const long = 'Bullet text that explains the slide in enough detail to stand on its own as a section.\n'.repeat(3);
  const units = [
    { index: 1, title: 'Intro to SQL', text: long },
    { index: 2, title: 'Joins', text: long },
  ];
  const sections = segmentUnits(units, 'pptx', 'Deck');
  assert.deepEqual(sections.map(s => s.heading), ['Intro to SQL', 'Joins']);
  assert.deepEqual(sections.map(s => s.location), [{ slide: 1 }, { slide: 2 }]);
});

test('segmentUnits merges consecutive tiny slides and spans their slide range', () => {
  const units = [1, 2, 3].map(i => ({ index: i, title: `Slide title ${i}`, text: 'one bullet' }));
  const [only, ...rest] = segmentUnits(units, 'pptx', 'Deck');
  assert.equal(rest.length, 0);
  assert.deepEqual(only.location, { slideStart: 1, slideEnd: 3 });
});

test('location and reference formatting', () => {
  assert.equal(formatLocation({ page: 12 }), 'p. 12');
  assert.equal(formatLocation({ pageStart: 12, pageEnd: 14 }), 'pp. 12–14');
  assert.equal(formatLocation({ slide: 3 }), 'slide 3');
  assert.equal(formatLocation({ slideStart: 3, slideEnd: 5 }), 'slides 3–5');
  assert.equal(formatLocation({}), '');
  assert.equal(formatSourceReference('DBMS Notes', { page: 12 }), 'DBMS Notes, p. 12');
  assert.equal(formatSourceReference('Notes', {}), 'Notes');
});

test('detectKind checks extension and magic bytes', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7');
  const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
  assert.equal(detectKind('a.pdf', pdf), 'pdf');
  assert.equal(detectKind('a.PDF', pdf), 'pdf');
  assert.equal(detectKind('a.pdf', zip), null);
  assert.equal(detectKind('a.docx', zip), 'docx');
  assert.equal(detectKind('a.pptx', zip), 'pptx');
  assert.equal(detectKind('a.docx', pdf), null);
  assert.equal(detectKind('a.md', new TextEncoder().encode('# hi')), 'text');
  assert.equal(detectKind('a.txt', new Uint8Array([0x61, 0, 0x62])), null);
  assert.equal(detectKind('a.exe', pdf), null);
  assert.equal(detectKind('noext', pdf), null);
});
