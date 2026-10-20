import { STOPWORDS } from '../ingestion/terms.ts';
import type { Grade, Question } from './types.ts';

/** Thresholds for short-answer grading. Deliberately lenient on typos and strict on missing key words. */
export const EDIT_SIMILARITY_ACCEPT = 0.85;
export const OVERLAP_ACCEPT_LONG = 0.6;
const SHORT_EXPECTED_TOKENS = 3;
const MIN_LONG_ANSWER_TOKENS = 3;
const MAX_EDIT_LENGTH = 600;

/** Lower-case, strip accents and punctuation, collapse spaces. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 for identical strings, falling towards 0 as they differ. */
export function editSimilarity(a: string, b: string): number {
  const x = normalizeAnswer(a).slice(0, MAX_EDIT_LENGTH);
  const y = normalizeAnswer(b).slice(0, MAX_EDIT_LENGTH);
  const longest = Math.max(x.length, y.length);
  return longest === 0 ? 1 : 1 - levenshtein(x, y) / longest;
}

const stem = (w: string) => (w.length > 3 ? w.replace(/ies$/, 'y').replace(/(?:es|s)$/, '') : w);
const keyTokens = (s: string) => normalizeAnswer(s).split(' ').filter(w => w && !STOPWORDS.has(w)).map(stem);

function tokenMatches(expected: string, given: string[]): boolean {
  return given.some(g => g === expected || (expected.length >= 5 && g.length >= 5 && levenshtein(g, expected) <= 1));
}

/** Fraction of the expected key words found in the response (tolerating plurals and one-letter typos). */
export function wordOverlap(expected: string, response: string): number {
  const want = keyTokens(expected);
  if (want.length === 0) return 0;
  const given = keyTokens(response);
  return want.filter(w => tokenMatches(w, given)).length / want.length;
}

function parseNumber(s: string): number | null {
  const m = /-?\d[\d,]*(?:\.\d+)?(?:e-?\d+)?|-?\.\d+/i.exec(s.replace(/\s+/g, ' '));
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Grades a response.
 * - Multiple choice and true/false: exact match, final.
 * - Numbers: within the question's relative tolerance.
 * - Short text: exact match, else edit-distance similarity (typos), else word overlap against the expected key words.
 *   Short and numeric grades are automatic, so `needsReview` is true: the UI must offer an override before saving.
 */
export function gradeResponse(q: Question, response: string): Grade {
  const text = response.trim();
  if (!text) return { correct: false, score: 0, needsReview: q.grading !== 'exact', method: 'empty', detail: 'No answer given' };

  if (q.grading === 'exact') {
    const ok = normalizeAnswer(text) === normalizeAnswer(q.answer);
    return { correct: ok, score: ok ? 1 : 0, needsReview: false, method: 'exact', detail: ok ? 'Exact match' : 'Not the correct option' };
  }

  if (q.grading === 'numeric' && q.numeric) {
    const given = parseNumber(text);
    if (given === null) return { correct: false, score: 0, needsReview: true, method: 'numeric', detail: 'No number found in the answer' };
    const { value, tolerance } = q.numeric;
    const error = Math.abs(given - value) / Math.max(1, Math.abs(value));
    const ok = error <= tolerance;
    return { correct: ok, score: ok ? 1 : Math.max(0, 1 - error), needsReview: true, method: 'numeric', detail: `Expected ${q.answer}, got ${given}` };
  }

  const targets = [q.gradeText ?? q.answer, ...q.acceptable];
  let best: Grade = { correct: false, score: 0, needsReview: true, method: 'word-overlap', detail: 'No key words matched' };
  for (const target of targets) {
    const expectedTokens = keyTokens(target);
    if (normalizeAnswer(text) === normalizeAnswer(target)) {
      return { correct: true, score: 1, needsReview: true, method: 'exact', detail: 'Exact match' };
    }
    const similarity = editSimilarity(text, target);
    if (similarity >= EDIT_SIMILARITY_ACCEPT) {
      return { correct: true, score: similarity, needsReview: true, method: 'edit-distance', detail: `${Math.round(similarity * 100)}% similar (typos allowed)` };
    }
    const overlap = wordOverlap(target, text);
    const long = expectedTokens.length > SHORT_EXPECTED_TOKENS;
    const answerTokens = keyTokens(text).length;
    const ok = long ? overlap >= OVERLAP_ACCEPT_LONG && answerTokens >= MIN_LONG_ANSWER_TOKENS : overlap === 1;
    const score = Math.max(similarity, overlap);
    if (ok || score > best.score) {
      best = {
        correct: ok, score, needsReview: true, method: 'word-overlap',
        detail: `${Math.round(overlap * 100)}% of the key words found`,
      };
      if (ok) break;
    }
  }
  return best;
}
