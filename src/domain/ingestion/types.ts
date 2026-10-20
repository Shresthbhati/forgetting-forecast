/**
 * Pure types for document ingestion. No framework or database imports: this layer is unit-tested with node --test.
 */

export type SourceKind = 'pdf' | 'pptx' | 'docx' | 'text';

/** Where a piece of text came from. Plain text and Word files carry no page numbers, so their location is empty. */
export type SourceLocation =
  | { page: number }
  | { slide: number }
  | { pageStart: number; pageEnd: number }
  | { slideStart: number; slideEnd: number }
  | Record<string, never>;

/** One page or slide of extracted text, 1-based `index`. `title` is only set for slides that have a title placeholder. */
export interface RawUnit {
  index: number;
  title?: string | null;
  text: string;
}

export interface Section {
  ordinal: number;
  level: number;
  heading: string;
  text: string;
  location: SourceLocation;
}

export interface ExtractedTerm {
  term: string;
  /** The sentence that defines the term, or null when only frequency/heading signals picked it. */
  definition: string | null;
  sectionOrdinal: number;
  location: SourceLocation;
  score: number;
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_UNITS = 300;
