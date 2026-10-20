/**
 * Rolls concept-level predicted recall up to topic and subject level. Pure.
 * These are ESTIMATES (the model's predicted recall probability now), not observed accuracy.
 */

export interface RollupConcept {
  id: string;
  subject: string;
  topic: string | null;
  /** Predicted recall probability now (0-1). */
  probability: number;
  repetitionCount: number;
  lapseCount: number;
}

export interface RollupNode {
  key: string;
  concepts: number;
  /** Mean predicted recall over the node's concepts. */
  meanRecall: number;
  /** Concepts whose predicted recall is below the target. */
  atRisk: number;
  /** Concepts reviewed at least once; the rest are still on the model's starting estimate. */
  reviewed: number;
  lapses: number;
  weakest: { id: string; probability: number } | null;
}

export interface SubjectRollup extends RollupNode {
  topics: RollupNode[];
}

export const NO_TOPIC = '(no topic)';

function node(key: string, items: RollupConcept[], target: number): RollupNode {
  const weakest = items.reduce<RollupConcept | null>((w, c) => (w === null || c.probability < w.probability ? c : w), null);
  const mean = items.reduce((s, c) => s + c.probability, 0) / items.length;
  return {
    key,
    concepts: items.length,
    meanRecall: Math.round(mean * 1000) / 1000,
    atRisk: items.filter(c => c.probability < target).length,
    reviewed: items.filter(c => c.repetitionCount > 0).length,
    lapses: items.reduce((s, c) => s + c.lapseCount, 0),
    weakest: weakest ? { id: weakest.id, probability: weakest.probability } : null,
  };
}

const groupBy = <T,>(items: T[], key: (t: T) => string): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
};

/** Subjects (weakest first), each with its topics (weakest first). A subject's figure is over all its concepts, not an average of topic averages. */
export function rollUp(concepts: RollupConcept[], target: number): SubjectRollup[] {
  return [...groupBy(concepts, c => c.subject).entries()]
    .map(([subject, items]): SubjectRollup => ({
      ...node(subject, items, target),
      topics: [...groupBy(items, c => c.topic?.trim() || NO_TOPIC).entries()]
        .map(([topic, rows]) => node(topic, rows, target))
        .sort((a, b) => a.meanRecall - b.meanRecall || a.key.localeCompare(b.key)),
    }))
    .sort((a, b) => a.meanRecall - b.meanRecall || a.key.localeCompare(b.key));
}
