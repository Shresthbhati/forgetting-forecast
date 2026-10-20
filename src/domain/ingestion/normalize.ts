import type { RawUnit } from './types.ts';

const PAGE_NUMBER_LINE = /^\s*(?:[-–—]\s*)?(?:page\s+)?\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?(?:\s*[-–—])?\s*$/i;

/**
 * Repairs the damage text extraction does to prose: Windows line endings, trailing spaces, tabs,
 * words hyphenated across a line break ("normal-\nization"), runs of blank lines and soft hyphens.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/­/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lines are compared with digits masked so "Chapter 3 | 12" and "Chapter 3 | 13" count as the same header. */
function lineKey(line: string): string {
  return line.trim().replace(/\d+/g, '#').toLowerCase();
}

/**
 * Removes running headers/footers and page numbers. A line is a header/footer when its masked form appears on
 * more than half of the pages; this needs at least 3 pages to be meaningful. Standalone page numbers go on any
 * unit count. Lines that are real content (long or unique) are never touched.
 */
export function stripHeadersAndFooters(units: RawUnit[]): RawUnit[] {
  const counts = new Map<string, number>();
  for (const unit of units) {
    const seen = new Set<string>();
    for (const line of unit.text.split('\n')) {
      const key = lineKey(line);
      if (key && !seen.has(key)) {
        seen.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const repeated = new Set<string>();
  if (units.length >= 3) {
    for (const [key, n] of counts) if (n > units.length / 2 && key.length <= 120) repeated.add(key);
  }
  return units.map(unit => ({
    ...unit,
    text: unit.text
      .split('\n')
      .filter(line => !PAGE_NUMBER_LINE.test(line) && !repeated.has(lineKey(line)))
      .join('\n'),
  }));
}

/** Normalizes every unit, then strips headers/footers (not for slides: repeated slide text is content). */
export function normalizeUnits(units: RawUnit[], opts: { stripRepeated: boolean }): RawUnit[] {
  const cleaned = units.map(u => ({ ...u, title: u.title ? normalizeText(u.title) : u.title, text: normalizeText(u.text) }));
  return opts.stripRepeated ? stripHeadersAndFooters(cleaned) : cleaned;
}
