import type { ExtractedTerm, Section } from './types.ts';

export const STOPWORDS = new Set((
  'a about above after again against all also am an and any are as at be because been before being below between both but by ' +
  'can cannot could did do does doing down during each either else etc even ever every few for from further had has have having he her here hers ' +
  'herself him himself his how however i if in into is it its itself just least less let like many may me might more most much must my myself ' +
  'neither no nor not of off often on once one only onto or other others otherwise our ours ourselves out over own per perhaps rather same ' +
  'shall she should since so some such than that the their theirs them themselves then there therefore these they this those though through thus ' +
  'to too toward under unless until up upon us use used uses using various very via was we well were what when whenever where whereas whether ' +
  'which while who whom whose why will with within without would yet you your yours yourself yourselves ' +
  'example examples following figure table chapter section page etc eg ie'
).split(/\s+/));

export const PRONOUN_STARTS = new Set([
  'it', 'this', 'that', 'these', 'those', 'they', 'there', 'he', 'she', 'we', 'you', 'i', 'which', 'what', 'who', 'here',
  'such', 'some', 'many', 'most', 'all', 'each', 'every', 'both', 'one', 'another', 'other', 'its', 'their', 'our', 'your',
]);

const LABELS = new Set([
  'note', 'notes', 'example', 'examples', 'important', 'warning', 'tip', 'remember', 'summary', 'answer', 'question',
  'hint', 'source', 'figure', 'table', 'step', 'goal', 'goals', 'input', 'output', 'syntax', 'definition', 'solution',
  'problem', 'recall', 'review', 'objective', 'objectives', 'agenda', 'conclusion', 'abstract', 'contents',
]);

const WORD = /[\p{L}\d][\p{L}\d'’-]*/gu;
const MAX_PHRASE_WORDS = 4;
const MAX_DEFINITION_SENTENCE = 400;
const MIN_DEFINITION_SENTENCE = 25;

function isNumeric(word: string): boolean {
  return /^\d+([.,-]\d+)*$/.test(word);
}

/** A phrase needs one "real" word: 4+ letters, or an acronym such as SQL / 1NF. */
function hasSubstance(words: string[]): boolean {
  return words.some(w => /^\p{L}{4,}/u.test(w) || /^[\p{Lu}\d]{2,}$/u.test(w));
}

/**
 * Candidate key phrases: runs of 1–4 consecutive non-stopwords (split at stopwords and punctuation). Longer runs
 * yield their 2- and 3-word windows. Returns lower-cased keys with their first surface form.
 */
export function candidatePhrases(text: string): Map<string, { surface: string; count: number }> {
  const out = new Map<string, { surface: string; count: number }>();
  const add = (words: string[]) => {
    if (!hasSubstance(words)) return;
    const key = words.join(' ').toLowerCase();
    const prior = out.get(key);
    if (prior) prior.count += 1;
    else out.set(key, { surface: words.join(' '), count: 1 });
  };

  for (const clause of text.split(/[\n.!?;:,()[\]{}"“”—–]|\s-\s/)) {
    const tokens = clause.match(WORD) ?? [];
    let run: string[] = [];
    const flush = () => {
      if (run.length === 0) return;
      if (run.length <= MAX_PHRASE_WORDS) add(run);
      else for (const n of [2, 3]) for (let i = 0; i + n <= run.length; i++) add(run.slice(i, i + n));
      run = [];
    };
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (STOPWORDS.has(lower) || isNumeric(token) || token.length < 2) flush();
      else run.push(token);
    }
    flush();
  }
  return out;
}

const TERM = String.raw`[\p{L}\d][\p{L}\d'’/-]*(?:\s+[\p{L}\d][\p{L}\d'’/-]*){0,4}?(?:\s*\([^)]{1,16}\))?`;
const VERB_STRICT = String.raw`is defined as|are defined as|is known as|are known as|refers? to|is called|are called|means`;
const IS_ARE = new RegExp(String.raw`^(?:(?:an?|the)\s+)?(${TERM})\s+(is|are)\s+((?:an?|the|one|any|each|set|collection|process)\s.+)$`, 'iu');
const STRICT = new RegExp(String.raw`^(?:(?:an?|the)\s+)?(${TERM})\s+(?:${VERB_STRICT})\s+(.{12,})$`, 'iu');
const COLON = new RegExp(String.raw`^(${TERM}):\s+(.{20,})$`, 'u');
const DASH = new RegExp(String.raw`^(${TERM})\s(?:[—–]|-)\s(.{20,})$`, 'u');

function validTerm(raw: string): string | null {
  const term = raw.trim().replace(/^(?:an?|the)\s+/i, '');
  const bare = term.replace(/\s*\([^)]*\)\s*$/, '');
  const words = bare.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  const first = words[0].toLowerCase();
  const last = words[words.length - 1].toLowerCase();
  if (PRONOUN_STARTS.has(first) || STOPWORDS.has(last) || LABELS.has(bare.toLowerCase())) return null;
  if (words.every(w => STOPWORDS.has(w.toLowerCase()))) return null;
  if (!hasSubstance(words)) return null;
  return term;
}

export function splitSentences(text: string): string[] {
  return text
    .split('\n')
    .flatMap(line => line.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“(])/u))
    .map(s => s.trim().replace(/^(?:[-•*▪◦‣]|\d+[.)])\s+/, ''))
    .filter(Boolean);
}

/**
 * Splits one definition sentence into the defined term and the rest ("body"):
 * "Normalization is the process of organizing data." -> { term: "Normalization", body: "the process of organizing data." }.
 * Returns null when the sentence is not a recognised definition.
 */
export function splitDefinition(sentence: string): { term: string; body: string } | null {
  if (sentence.length < MIN_DEFINITION_SENTENCE || sentence.length > MAX_DEFINITION_SENTENCE || sentence.endsWith('?')) return null;
  if (!/^[\p{Lu}\d]/u.test(sentence)) return null;
  const strict = STRICT.exec(sentence);
  const isAre = strict ? null : IS_ARE.exec(sentence);
  const other = strict || isAre ? null : (COLON.exec(sentence) ?? DASH.exec(sentence));
  const match = strict ?? isAre ?? other;
  if (!match) return null;
  const term = validTerm(match[1]);
  if (!term) return null;
  return { term, body: isAre ? isAre[3] : match[2] };
}

/** Finds `X is/are/refers to/is defined as/means …`, `X: …` and `X — …` definitions. Returns the term and the whole sentence. */
export function findDefinitions(text: string): Array<{ term: string; sentence: string }> {
  const found: Array<{ term: string; sentence: string }> = [];
  for (const sentence of splitSentences(text)) {
    const split = splitDefinition(sentence);
    if (split) found.push({ term: split.term, sentence });
  }
  return found;
}

const keyOf = (term: string) => term.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();

export interface TermOptions {
  /** Section count and per-phrase document frequency from other sources in the same subject (for TF-IDF). */
  externalSections?: number;
  externalDocFreq?: Map<string, number>;
  /** Cap on non-definition candidates kept per source. */
  maxCandidates?: number;
}

/**
 * Key terms for a source. TF-IDF is computed over its sections (plus the subject's other sections when given),
 * boosted when a phrase is in a heading or has a detected definition. Every definition is kept; other candidates
 * need 2+ occurrences or a heading appearance.
 */
export function extractTerms(sections: Section[], opts: TermOptions = {}): ExtractedTerm[] {
  const maxCandidates = opts.maxCandidates ?? 50;
  const totalSections = sections.length + (opts.externalSections ?? 0);

  interface Stat { surface: string; tf: number; df: number; best: { ordinal: number; tf: number } }
  const stats = new Map<string, Stat>();
  for (const section of sections) {
    for (const [key, { surface, count }] of candidatePhrases(section.text)) {
      const stat = stats.get(key) ?? { surface, tf: 0, df: 0, best: { ordinal: section.ordinal, tf: 0 } };
      stat.tf += count;
      stat.df += 1;
      if (count > stat.best.tf) stat.best = { ordinal: section.ordinal, tf: count };
      stats.set(key, stat);
    }
  }

  const headingText = sections.map(s => s.heading.toLowerCase());
  const inHeading = (key: string) => headingText.some(h => h.includes(key));
  const idf = (key: string, localDf: number) =>
    Math.log(1 + (totalSections + 1) / (localDf + (opts.externalDocFreq?.get(key) ?? 0) + 1));
  const tfidf = (key: string, stat: Stat) =>
    (1 + Math.log(stat.tf)) * idf(key, stat.df) * (1 + 0.3 * (key.split(' ').length - 1));

  // Definitions first: they always make the list.
  const byKey = new Map<string, ExtractedTerm>();
  for (const section of sections) {
    for (const { term, sentence } of findDefinitions(section.text)) {
      const key = keyOf(term);
      if (byKey.has(key)) continue;
      const stat = stats.get(key);
      const base = stat ? tfidf(key, stat) : 1;
      byKey.set(key, {
        term,
        definition: sentence,
        sectionOrdinal: section.ordinal,
        location: section.location,
        score: round(base * 1.5 + 1 + (inHeading(key) ? 1 : 0)),
      });
    }
  }

  const candidates: ExtractedTerm[] = [];
  for (const [key, stat] of stats) {
    if (byKey.has(key)) continue;
    const headed = inHeading(key);
    if (stat.tf < 2 && !headed) continue;
    const section = sections.find(s => s.ordinal === stat.best.ordinal) ?? sections[0];
    // Surface forms captured at a sentence start are capitalised; restore lower case unless it looks like an acronym/proper name.
    const surface = /^\p{Lu}\p{Ll}+(\s\p{Ll}+)*$/u.test(stat.surface) ? stat.surface.toLowerCase() : stat.surface;
    candidates.push({
      term: surface,
      definition: null,
      sectionOrdinal: section.ordinal,
      location: section.location,
      score: round(tfidf(key, stat) * (headed ? 2 : 1)),
    });
  }
  candidates.sort((a, b) => b.score - a.score);

  return [...byKey.values(), ...candidates.slice(0, maxCandidates)].sort((a, b) => b.score - a.score);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** First sentence of `text` that mentions `term` (case-insensitive), used when a term has no detected definition. */
export function contextSentence(text: string, term: string): string | null {
  const needle = keyOf(term);
  return splitSentences(text).find(s => s.toLowerCase().includes(needle) && s.length >= MIN_DEFINITION_SENTENCE && s.length <= MAX_DEFINITION_SENTENCE) ?? null;
}
