/**
 * Prerequisite links between defined terms (phase 5). Pure.
 *
 * Term A is a prerequisite of term B when A's name appears inside B's definition AND A is defined in the same or an
 * earlier section of the same source. If two terms in the same section name each other the direction is ambiguous,
 * so neither edge is kept. Only defined terms take part (a bare frequency-picked phrase has no definition to mention).
 */

import { splitDefinition } from '../ingestion/terms.ts';

export interface GraphTerm {
  id: string;
  term: string;
  definition: string | null;
  /** Position of the section the term was found in, within its source. */
  sectionOrdinal: number;
}

export interface Edge {
  /** The prerequisite. */
  from: string;
  /** The term whose definition mentions it. */
  to: string;
}

const MIN_KEY_CHARS = 3;
const bare = (term: string) => term.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function bodyOf(t: GraphTerm): string | null {
  if (!t.definition) return null;
  return (splitDefinition(t.definition)?.body ?? t.definition).toLowerCase();
}

/** A term is mentioned in its singular or plural form ("tuple" / "tuples", "candidate key" / "candidate keys"). */
const mentionPattern = (key: string) => new RegExp(`\\b${escapeRegExp(key)}(?:s|es)?\\b`);

/** Keys mentioned in `body`, dropping a key that only appears inside a longer matched key ("key" inside "candidate key"). */
function mentionedKeys(body: string, keys: string[]): string[] {
  const hits = keys.filter(k => mentionPattern(k).test(body)).sort((a, b) => b.length - a.length);
  return hits.filter((k, i) => !hits.slice(0, i).some(longer => longer !== k && longer.includes(k)));
}

export function buildPrerequisiteEdges(terms: GraphTerm[]): Edge[] {
  const defined = terms.filter(t => t.definition && bare(t.term).length >= MIN_KEY_CHARS);
  const byKey = new Map<string, GraphTerm>();
  for (const t of defined) if (!byKey.has(bare(t.term))) byKey.set(bare(t.term), t);
  const keys = [...byKey.keys()];

  // mentions.get(B) = the terms B's definition names
  const mentions = new Map<string, Set<string>>();
  for (const b of byKey.values()) {
    const body = bodyOf(b);
    if (!body) continue;
    const own = bare(b.term);
    const set = new Set<string>();
    for (const key of mentionedKeys(body, keys.filter(k => k !== own))) set.add(byKey.get(key)!.id);
    mentions.set(b.id, set);
  }

  const edges: Edge[] = [];
  for (const [bId, set] of mentions) {
    const b = defined.find(t => t.id === bId)!;
    for (const aId of set) {
      const a = defined.find(t => t.id === aId)!;
      if (a.sectionOrdinal > b.sectionOrdinal) continue; // defined later: not something B could be built on
      if (a.sectionOrdinal === b.sectionOrdinal && mentions.get(aId)?.has(bId)) continue; // mutual, same section: ambiguous
      edges.push({ from: aId, to: bId });
    }
  }
  return edges.sort((x, y) => x.to.localeCompare(y.to) || x.from.localeCompare(y.from));
}

export const prerequisitesOf = (edges: Edge[], termId: string): string[] => edges.filter(e => e.to === termId).map(e => e.from);
export const dependentsOf = (edges: Edge[], termId: string): string[] => edges.filter(e => e.from === termId).map(e => e.to);

export interface ConceptStatus {
  conceptId: string;
  /** Predicted recall probability now. */
  probability: number;
  lapseCount: number;
  repetitionCount: number;
}

export interface PrerequisiteRow {
  termId: string;
  term: string;
  conceptId: string | null;
  predictedRecall: number | null;
  lapseCount: number;
  reviewed: boolean;
  needsCheck: boolean;
  /** Why it needs a check, in words the UI can show. */
  reason: string | null;
}

export interface PrerequisiteReport {
  /** True when the concept itself is below target or has lapsed: the case "Struggling with B -> check A" is for. */
  struggling: boolean;
  prerequisites: PrerequisiteRow[];
  dependents: number;
}

export function prerequisiteReport(input: {
  termId: string;
  terms: GraphTerm[];
  /** Concept status per term id, for terms that have a concept. */
  statuses: Record<string, ConceptStatus | undefined>;
  target: number;
}): PrerequisiteReport {
  const edges = buildPrerequisiteEdges(input.terms);
  const focus = input.statuses[input.termId];
  const struggling = !!focus && (focus.probability < input.target || focus.lapseCount > 0);

  const prerequisites = prerequisitesOf(edges, input.termId).map((id): PrerequisiteRow => {
    const t = input.terms.find(x => x.id === id)!;
    const s = input.statuses[id];
    let reason: string | null = null;
    if (!s) reason = 'Not a concept yet, so nothing tracks it';
    else if (s.repetitionCount === 0) reason = 'Never reviewed';
    else if (s.probability < input.target) reason = `Predicted recall ${Math.round(s.probability * 100)}% is below your ${Math.round(input.target * 100)}% target`;
    else if (s.lapseCount > 0) reason = `Lapsed ${s.lapseCount} time${s.lapseCount === 1 ? '' : 's'}`;
    return {
      termId: id, term: t.term, conceptId: s?.conceptId ?? null, predictedRecall: s?.probability ?? null,
      lapseCount: s?.lapseCount ?? 0, reviewed: (s?.repetitionCount ?? 0) > 0, needsCheck: reason !== null, reason,
    };
  });
  prerequisites.sort((a, b) => Number(b.needsCheck) - Number(a.needsCheck) || (a.predictedRecall ?? -1) - (b.predictedRecall ?? -1) || a.term.localeCompare(b.term));
  return { struggling, prerequisites, dependents: dependentsOf(edges, input.termId).length };
}
