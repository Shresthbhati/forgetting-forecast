import type { SourceKind, SourceLocation } from './types.ts';

/** "p. 12", "pp. 12–14", "slide 3", "slides 3–5", or '' when the file has no page structure. */
export function formatLocation(location: SourceLocation | null | undefined): string {
  if (!location) return '';
  const l = location as Record<string, number | undefined>;
  if (l.page !== undefined) return `p. ${l.page}`;
  if (l.slide !== undefined) return `slide ${l.slide}`;
  if (l.pageStart !== undefined && l.pageEnd !== undefined) {
    return l.pageStart === l.pageEnd ? `p. ${l.pageStart}` : `pp. ${l.pageStart}–${l.pageEnd}`;
  }
  if (l.slideStart !== undefined && l.slideEnd !== undefined) {
    return l.slideStart === l.slideEnd ? `slide ${l.slideStart}` : `slides ${l.slideStart}–${l.slideEnd}`;
  }
  return '';
}

/** "Database Notes, p. 12" — the label shown as "From: …" on concepts and review cards. */
export function formatSourceReference(title: string, location: SourceLocation | null | undefined): string {
  const loc = formatLocation(location);
  return loc ? `${title}, ${loc}` : title;
}

/** Builds a location from the first and last unit a section covers; Word and text files have none. */
export function locationFromRange(kind: SourceKind, start: number, end: number): SourceLocation {
  if (kind === 'docx' || kind === 'text') return {};
  if (kind === 'pptx') return start === end ? { slide: start } : { slideStart: start, slideEnd: end };
  return start === end ? { page: start } : { pageStart: start, pageEnd: end };
}
