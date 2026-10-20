/**
 * Mixed tests across subjects (phase 4). Pure.
 *
 *  - Which concepts: weighted random sampling, weight = (1 - predicted recall) x (1 + 0.3 x lapses) + a small floor,
 *    so what the model expects you to forget (and what you have lapsed on) is likelier to appear, but nothing is certain.
 *  - Order: interleaved across subjects (at most two in a row from one subject).
 *  - Which item: for a concept made from a source, a DIFFERENT generated item than the last one answered (new type,
 *    new blank or numbers), so the test checks understanding rather than memorised wording.
 */

import { ALL_TERM_TYPES, generateQuestions } from './generators.ts';
import { makeRng, type Rng } from './random.ts';
import type { PoolEntry, Question, TermInput, TermQuestionType } from './types.ts';

export const LAPSE_WEIGHT = 0.3;
export const MAX_LAPSES_COUNTED = 6;
const WEIGHT_FLOOR = 0.02;
export const MAX_SAME_SUBJECT_RUN = 2;

export interface MixedConcept {
  conceptId: string;
  subject: string;
  topic: string | null;
  /** Predicted recall probability now. */
  probability: number;
  lapseCount: number;
  prompt: string;
  answer: string;
  /** The source term this concept was made from, when there is one (enables generated variants). */
  term: TermInput | null;
}

export interface MixedItem extends Question {
  subject: string;
  predictedRecall: number;
  lapseCount: number;
}

export function weightOf(c: Pick<MixedConcept, 'probability' | 'lapseCount'>): number {
  return (1 - c.probability) * (1 + LAPSE_WEIGHT * Math.min(c.lapseCount, MAX_LAPSES_COUNTED)) + WEIGHT_FLOOR;
}

/** Weighted sampling without replacement (Efraimidis-Spirakis): each item gets key u^(1/w); the largest keys win. */
export function selectWeighted<T>(items: T[], weight: (t: T) => number, size: number, rng: Rng): T[] {
  return items
    .map(item => ({ item, key: Math.pow(rng(), 1 / Math.max(weight(item), 1e-9)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, size)
    .map(x => x.item);
}

/** Reorders so no more than `maxRun` consecutive items share a group, keeping the original order otherwise. */
export function interleave<T>(items: T[], group: (t: T) => string, maxRun = MAX_SAME_SUBJECT_RUN): T[] {
  const remaining = [...items];
  const out: T[] = [];
  while (remaining.length > 0) {
    const tail = out.slice(-maxRun);
    const blocked = tail.length === maxRun && tail.every(t => group(t) === group(tail[0])) ? group(tail[0]) : null;
    let index = remaining.findIndex(t => group(t) !== blocked);
    if (index === -1) index = 0; // only one subject left: nothing to interleave with
    out.push(remaining.splice(index, 1)[0]);
  }
  return out;
}

/**
 * Orders the eligible types so the one used longest ago (or never) comes first. `recent` is the concept's earlier
 * question types, most recent first. Ties are broken at random.
 */
export function orderVariantTypes(recent: string[], eligible: TermQuestionType[], rng: Rng): TermQuestionType[] {
  const age = (type: TermQuestionType) => {
    const i = recent.indexOf(type);
    return i === -1 ? Infinity : i; // larger index = used longer ago
  };
  return eligible
    .map(type => ({ type, age: age(type), tie: rng() }))
    .sort((a, b) => b.age - a.age || a.tie - b.tie)
    .map(x => x.type);
}

function recallQuestion(c: MixedConcept): Question {
  return {
    id: `q_recall_${c.conceptId}`,
    type: 'recall', grading: 'short', prompt: c.prompt, answer: c.answer, acceptable: [], gradeText: c.answer,
    explanation: '', conceptId: c.conceptId, sectionId: null, location: {}, label: 'Written by you', practiceOnly: false,
  };
}

function sourcedQuestion(c: MixedConcept, pool: PoolEntry[], recent: string[], rng: Rng, seed: number): Question | null {
  if (!c.term) return null;
  for (const type of orderVariantTypes(recent, ALL_TERM_TYPES, rng)) {
    const [q] = generateQuestions({ terms: [c.term], pool, formulas: [], types: [type], seed });
    if (q) return q;
  }
  return null;
}

export interface MixedInput {
  concepts: MixedConcept[];
  /** Defined terms per subject, the pool wrong multiple-choice options come from. */
  pools: Record<string, PoolEntry[]>;
  /** Per concept: earlier question types answered, most recent first. */
  recentTypes: Record<string, string[]>;
  size: number;
  seed: number;
}

export function buildMixedTest(input: MixedInput): MixedItem[] {
  const rng = makeRng(input.seed);
  const chosen = interleave(selectWeighted(input.concepts, weightOf, input.size, rng), c => c.subject);
  return chosen.map((c, i) => {
    const question =
      sourcedQuestion(c, input.pools[c.subject] ?? [], input.recentTypes[c.conceptId] ?? [], rng, input.seed + i + 1) ?? recallQuestion(c);
    return { ...question, subject: c.subject, predictedRecall: c.probability, lapseCount: c.lapseCount };
  });
}
