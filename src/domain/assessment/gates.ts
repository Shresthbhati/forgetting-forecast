import { PRONOUN_STARTS, STOPWORDS } from '../ingestion/terms.ts';
import type { Question } from './types.ts';

export const MIN_STEM_CHARS = 20;
export const MIN_STEM_WORDS = 4;
export const MIN_CONTENT_WORDS = 3;
export const MIN_BODY_WORDS = 3;
export const BLANK = '_____';

const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\d][\p{L}\d'’-]*/gu) ?? [];

export function contentWords(text: string): string[] {
  return wordsOf(text).filter(w => !STOPWORDS.has(w));
}

/**
 * Quality gate for a question stem. Rejects stems that are too short, or that would be only pronouns and
 * function words once the blank is removed ("What is it?"), so a question can't be answered without the text.
 */
export function passesStemGate(stem: string): boolean {
  const bare = stem.split(BLANK).join(' ').replace(/[?:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (bare.length < MIN_STEM_CHARS) return false;
  const words = wordsOf(bare);
  if (words.length < MIN_STEM_WORDS) return false;
  if (words.every(w => STOPWORDS.has(w) || PRONOUN_STARTS.has(w))) return false;
  return contentWords(bare).length >= MIN_CONTENT_WORDS;
}

/** A definition body needs enough substance to be worth asking about. */
export function passesBodyGate(body: string): boolean {
  return wordsOf(body).length >= MIN_BODY_WORDS && contentWords(body).length >= 2;
}

const key = (q: Question) => `${q.type}|${q.prompt.toLowerCase().replace(/\s+/g, ' ').trim()}`;

/** Drops repeated prompts (same type and normalised text), keeping the first. */
export function dedupeQuestions(questions: Question[]): Question[] {
  const seen = new Set<string>();
  return questions.filter(q => {
    const k = key(q);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
