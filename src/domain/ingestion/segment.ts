import { locationFromRange } from './location.ts';
import type { RawUnit, Section, SourceKind } from './types.ts';

export const MIN_SECTION_CHARS = 200;
export const MAX_SECTION_CHARS = 6000;

interface Line {
  unit: number;
  text: string;
}

interface Heading {
  level: number;
  text: string;
}

const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s+(\p{Lu}[^\n]{1,88})$/u;
const MARKDOWN = /^(#{1,6})\s+(.+?)\s*#*$/;
const ALL_CAPS = /^[\p{Lu}][\p{Lu}\d ,&:/'()-]{2,60}$/u;
const BULLET = /^(?:[-•*▪◦‣]|\d+[.)])\s/;

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Recognises "# Title", "1.2 Title", and short ALL-CAPS lines. Returns null for ordinary text. */
export function detectHeading(line: string): Heading | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return null;

  const md = MARKDOWN.exec(trimmed);
  if (md) return { level: md[1].length, text: md[2] };

  const num = NUMBERED.exec(trimmed);
  if (num && wordCount(trimmed) <= 12 && !/[.,;:!?]$/.test(trimmed)) {
    return { level: Math.min(6, num[1].split('.').length), text: `${num[1]} ${num[2]}` };
  }

  if (ALL_CAPS.test(trimmed) && /\p{Lu}{3}/u.test(trimmed) && wordCount(trimmed) <= 8 && !/^\d+$/.test(trimmed)) {
    return { level: 1, text: trimmed };
  }
  return null;
}

/**
 * Re-joins lines the PDF wrapped mid-sentence: a line that starts in lower case continues the previous line.
 * Lines starting with a capital, digit or bullet stay separate, so list items and "Term: definition" lines survive.
 */
function reflow(lines: string[]): string {
  const out: string[] = [];
  for (const line of lines) {
    const startsContinuation = /^[\p{Ll}(,;]/u.test(line) && !BULLET.test(line);
    if (out.length > 0 && startsContinuation && out[out.length - 1] !== '') out[out.length - 1] += ` ${line}`;
    else out.push(line);
  }
  return out.join('\n');
}

interface Draft {
  level: number;
  heading: string;
  /** Page/slide the heading itself sits on, so a heading with no body still has a location. */
  unit: number;
  lines: Line[];
}

function toSection(draft: Draft, kind: SourceKind, reflowText: boolean): Omit<Section, 'ordinal'> {
  const units = [draft.unit, ...draft.lines.map(l => l.unit)];
  const start = Math.min(...units);
  const end = Math.max(...units);
  const raw = draft.lines.map(l => l.text);
  return {
    level: draft.level,
    heading: draft.heading,
    text: (reflowText ? reflow(raw) : raw.join('\n')).trim(),
    location: locationFromRange(kind, start, end),
  };
}

/** Splits a draft that exceeds the cap at line boundaries, keeping per-part page ranges accurate. */
function capDraft(draft: Draft): Draft[] {
  const total = draft.lines.reduce((n, l) => n + l.text.length + 1, 0);
  if (total <= MAX_SECTION_CHARS) return [draft];
  const parts: Draft[] = [];
  let current: Line[] = [];
  let size = 0;
  for (const line of draft.lines) {
    if (size + line.text.length > MAX_SECTION_CHARS && current.length > 0) {
      parts.push({ level: draft.level, heading: draft.heading, unit: current[0].unit, lines: current });
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.text.length + 1;
  }
  if (current.length) parts.push({ level: draft.level, heading: draft.heading, unit: current[0].unit, lines: current });
  return parts.map((p, i) => (i === 0 ? p : { ...p, heading: `${draft.heading} (part ${i + 1})` }));
}

/** Folds sections shorter than MIN_SECTION_CHARS into their neighbour so the outline is not full of one-liners. */
function mergeTiny(drafts: Draft[]): Draft[] {
  const size = (d: Draft) => d.lines.reduce((n, l) => n + l.text.length, 0);
  const out: Draft[] = [];
  for (const d of drafts) {
    const prev = out[out.length - 1];
    if (prev && size(d) < MIN_SECTION_CHARS && size(prev) + size(d) <= MAX_SECTION_CHARS) {
      // Keep the child's heading visible inside the parent's text.
      prev.lines.push({ unit: d.unit, text: d.heading }, ...d.lines);
    } else {
      out.push({ ...d, lines: [...d.lines] });
    }
  }
  // A tiny first section has nothing before it: fold it forward.
  if (out.length > 1 && size(out[0]) < MIN_SECTION_CHARS && size(out[0]) + size(out[1]) <= MAX_SECTION_CHARS) {
    const [first, second] = out;
    out.splice(0, 2, {
      level: first.level,
      heading: first.heading,
      unit: first.unit,
      lines: [...first.lines, { unit: second.unit, text: second.heading }, ...second.lines],
    });
  }
  return out;
}

/**
 * Turns normalized pages/slides into an outline of sections.
 * - Slides: one section per slide, headed by its title; tiny consecutive slides are merged.
 * - Pages / documents / text: headings (Markdown, numbered, ALL-CAPS) open new sections; text before the first
 *   heading becomes an introduction headed with `fallbackHeading`.
 * Every section records the page/slide range it spans.
 */
export function segmentUnits(units: RawUnit[], kind: SourceKind, fallbackHeading: string): Section[] {
  const drafts: Draft[] = [];

  if (kind === 'pptx') {
    for (const unit of units) {
      const lines = unit.text.split('\n').filter(Boolean).map(text => ({ unit: unit.index, text }));
      const title = unit.title?.trim() || (lines.length ? lines[0].text.slice(0, 80) : `Slide ${unit.index}`);
      if (lines.length === 0 && !unit.title) continue;
      drafts.push({ level: 1, heading: title, unit: unit.index, lines });
    }
  } else {
    let current: Draft = { level: 1, heading: fallbackHeading, unit: units[0]?.index ?? 1, lines: [] };
    // The introduction (text before the first heading) is only kept if it has text; real headings always are.
    const flush = () => {
      if (current.lines.length > 0 || current.heading !== fallbackHeading) drafts.push(current);
    };
    for (const unit of units) {
      for (const text of unit.text.split('\n')) {
        const line = text.trim();
        if (!line) continue;
        const heading = detectHeading(line);
        if (heading) {
          flush();
          current = { level: heading.level, heading: heading.text, unit: unit.index, lines: [] };
        } else {
          current.lines.push({ unit: unit.index, text: line });
        }
      }
    }
    flush();
  }

  const sized = mergeTiny(drafts).flatMap(capDraft);
  return sized.map((d, ordinal) => ({ ordinal, ...toSection(d, kind, kind !== 'pptx') }));
}
