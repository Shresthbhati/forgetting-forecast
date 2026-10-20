import { formatLocation } from '../ingestion/location.ts';
import { splitDefinition } from '../ingestion/terms.ts';
import { BLANK, contentWords, dedupeQuestions, passesBodyGate, passesStemGate } from './gates.ts';
import { evaluate, findFormulas, type Formula } from './formula.ts';
import { hashString, makeRng, randomInt, shuffle, type Rng } from './random.ts';
import type { FormulaInput, GeneratorInput, PoolEntry, Question, QuestionGenerator, QuestionType, TermInput, TermQuestionType } from './types.ts';

export { findFormulas };

export const ALL_TERM_TYPES: TermQuestionType[] = ['definition', 'cloze', 'mcq', 'truefalse'];
const DISTRACTORS = 3;

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bare = (term: string) => term.replace(/\s*\([^)]*\)\s*$/, '').trim();
/** The term as written in a sentence, including an acronym in parentheses straight after it ("First Normal Form (1NF)"). */
const termPattern = (name: string, flags = 'gi') => new RegExp(`\\b${escapeRegExp(name)}\\b(?:\\s*\\([^)]{1,16}\\))?`, flags);
const acronymOf = (term: string) => /\(([^)]{1,16})\)\s*$/.exec(term)?.[1]?.trim() ?? null;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\d]+/gu, ' ').trim();
const labelFor = (location: TermInput['location']) => {
  const loc = formatLocation(location);
  return loc ? `Generated from ${loc}` : 'Generated from the text';
};

interface Defined extends TermInput {
  definition: string;
  body: string;
}

function asDefined(t: TermInput): Defined | null {
  if (!t.definition) return null;
  const split = splitDefinition(t.definition);
  if (!split || !passesBodyGate(split.body)) return null;
  return { ...t, definition: t.definition, body: split.body };
}

function base(t: TermInput, type: QuestionType, grading: Question['grading'], prompt: string, answer: string, explanation: string): Question {
  return {
    id: `q_${hashString(`${type}|${prompt}`)}`,
    type, grading, prompt, answer, acceptable: [], explanation,
    termId: t.termId, conceptId: t.conceptId, sectionId: t.sectionId, location: t.location,
    label: labelFor(t.location), practiceOnly: t.conceptId === null,
  };
}

/** "Define: term" — the same prompt the concept uses; graded against the definition body. */
function definitionQuestion(t: Defined): Question | null {
  const q = base(t, 'definition', 'short', `Define: ${bare(t.term)}`, t.definition, t.definition);
  q.gradeText = t.body;
  return q;
}

/** Blanks the term (or, for variant 'keyword', its longest content word) out of the defining sentence. */
function clozeQuestion(t: Defined, rng: Rng): Question | null {
  const keywordFirst = rng() < 0.5;
  const tryTerm = (): Question | null => {
    const name = bare(t.term);
    if (!termPattern(name).test(t.definition)) return null;
    // The acronym goes with the term: leaving "(1NF)" behind would give the answer away.
    const stem = t.definition.replace(termPattern(name), BLANK);
    if (!passesStemGate(stem)) return null;
    const q = base(t, 'cloze', 'short', `Fill in the blank: ${stem}`, name, t.definition);
    const acronym = acronymOf(t.term);
    q.acceptable = [t.term, ...(acronym ? [acronym] : [])].filter(a => norm(a) !== norm(name));
    return q;
  };
  const tryKeyword = (): Question | null => {
    const termWords = new Set(norm(t.term).split(' '));
    const candidates = contentWords(t.body)
      .filter(w => w.length >= 6 && !termWords.has(w))
      .sort((a, b) => b.length - a.length);
    const word = candidates[0];
    if (!word) return null;
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    const matched = pattern.exec(t.definition);
    if (!matched) return null;
    const stem = t.definition.replace(pattern, BLANK);
    if (!passesStemGate(stem)) return null;
    return base(t, 'cloze', 'short', `Fill in the blank: ${stem}`, matched[0].toLowerCase(), t.definition);
  };
  return keywordFirst ? (tryKeyword() ?? tryTerm()) : (tryTerm() ?? tryKeyword());
}

interface PoolDefined {
  term: string;
  body: string;
}

function definedPool(pool: PoolEntry[], exclude: Defined): PoolDefined[] {
  const seen = new Set<string>([norm(exclude.term), norm(bare(exclude.term))]);
  const out: PoolDefined[] = [];
  for (const entry of pool) {
    const key = norm(entry.term);
    if (seen.has(key) || seen.has(norm(bare(entry.term)))) continue;
    const split = splitDefinition(entry.definition);
    if (!split || !passesBodyGate(split.body)) continue;
    seen.add(key);
    out.push({ term: entry.term, body: split.body });
  }
  return out;
}

const byLengthDistance = (target: number, rng: Rng) => (a: PoolDefined, b: PoolDefined) =>
  Math.abs(a.body.length - target) - Math.abs(b.body.length - target) || rng() - 0.5;

/** Term -> definition multiple choice. Wrong options are other terms' definitions from the same subject, closest in length. */
function mcqQuestion(t: Defined, pool: PoolEntry[], rng: Rng): Question | null {
  const correct = capitalise(t.body);
  const correctKey = norm(correct);
  const answerWords = norm(bare(t.term));
  const candidates = definedPool(pool, t)
    // A distractor that names the answer term would give it away, and an identical body would make two right answers.
    .filter(d => norm(d.body) !== correctKey && !norm(d.body).includes(answerWords))
    .sort(byLengthDistance(t.body.length, rng));
  const chosen: string[] = [];
  const keys = new Set([correctKey]);
  for (const d of candidates) {
    const text = capitalise(d.body);
    if (keys.has(norm(text))) continue;
    keys.add(norm(text));
    chosen.push(text);
    if (chosen.length === DISTRACTORS) break;
  }
  if (chosen.length < DISTRACTORS) return null;
  const prompt = `Which definition matches "${bare(t.term)}"?`;
  if (!passesStemGate(prompt)) return null;
  const q = base(t, 'mcq', 'exact', prompt, correct, t.definition);
  q.options = shuffle([correct, ...chosen], rng);
  return q;
}

/** True/false: the sentence as written, or with the term swapped for another term (so the definition no longer fits). */
function trueFalseQuestion(t: Defined, pool: PoolEntry[], rng: Rng): Question | null {
  const wantFalse = rng() < 0.5;
  let statement = t.definition;
  let answer = 'True';
  if (wantFalse) {
    const name = bare(t.term);
    const pattern = termPattern(name, 'i');
    const swap = definedPool(pool, t)
      .filter(d => norm(d.body) !== norm(t.body))
      .sort(byLengthDistance(t.body.length, rng))[0];
    if (swap && pattern.test(t.definition)) {
      statement = t.definition.replace(pattern, bare(swap.term));
      answer = 'False';
    }
  }
  if (!passesStemGate(statement)) return null;
  const q = base(t, 'truefalse', 'exact', `True or false: ${statement}`, answer, t.definition);
  q.options = ['True', 'False'];
  return q;
}

const formatNumber = (n: number) => String(Math.round(n * 100) / 100);

/** "Using F = m·a, find F when m = 4 and a = 3." with random values and a computed answer. */
function numericalQuestion(f: Formula, input: FormulaInput, rng: Rng): Question | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const values = Object.fromEntries(f.vars.map(v => [v, randomInt(rng, 2, 12)]));
    const result = evaluate(f.rhs, values);
    if (!Number.isFinite(result) || Math.abs(result) >= 1e7) continue;
    // Only keep results that are exact to two decimals so the expected answer is unambiguous.
    if (Math.abs(result * 100 - Math.round(result * 100)) > 1e-6) continue;
    const given = f.vars.map(v => `${v} = ${values[v]}`).join(', ');
    const prompt = `Using ${f.text}, find ${f.lhs} when ${given}.`;
    const answer = formatNumber(result);
    const substituted = f.rhs.replace(/[A-Za-z]/g, c => String(values[c] ?? c));
    return {
      id: `q_${hashString(`numerical|${prompt}`)}`,
      type: 'numerical', grading: 'numeric', prompt, answer, acceptable: [],
      numeric: { value: result, tolerance: 0.01 },
      explanation: `${f.lhs} = ${f.rhs.replace(/\*/g, '·')} = ${substituted.replace(/\*/g, '·')} = ${answer}`,
      conceptId: null, sectionId: input.sectionId, location: input.location,
      label: labelFor(input.location), practiceOnly: true,
    };
  }
  return null;
}

/** The built-in generator: rules only, no model. */
export const ruleBasedGenerator: QuestionGenerator = {
  generate(input: GeneratorInput): Question[] {
    const rng = makeRng(input.seed);
    const types = input.types?.length ? input.types : ALL_TERM_TYPES;
    const out: Question[] = [];

    const defined = input.terms.map(asDefined).filter((t): t is Defined => t !== null);
    const offset = Math.floor(rng() * types.length);
    defined.forEach((t, i) => {
      // One question per term, rotating through the types; if a type can't be made for this term, try the next.
      for (let k = 0; k < types.length; k++) {
        const type = types[(offset + i + k) % types.length];
        const q =
          type === 'definition' ? definitionQuestion(t)
          : type === 'cloze' ? clozeQuestion(t, rng)
          : type === 'mcq' ? mcqQuestion(t, input.pool, rng)
          : trueFalseQuestion(t, input.pool, rng);
        if (q) {
          out.push(q);
          break;
        }
      }
    });

    let numericals = 0;
    for (const source of input.formulas) {
      for (const f of findFormulas(source.text)) {
        if (numericals >= (input.maxNumerical ?? 2)) break;
        const q = numericalQuestion(f, source, rng);
        if (q) {
          out.push(q);
          numericals++;
        }
      }
    }
    return shuffle(dedupeQuestions(out), rng);
  },
};

export function generateQuestions(input: GeneratorInput): Question[] {
  return ruleBasedGenerator.generate(input);
}
