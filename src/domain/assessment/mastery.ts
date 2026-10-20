/**
 * Per-topic mastery from existing retrieval attempts. A topic is a section heading; mastery is the
 * recency-weighted share of correct attempts, and stays null (insufficient data) below MIN_MASTERY_ATTEMPTS.
 */

export const MIN_MASTERY_ATTEMPTS = 5;
export const MASTERY_HALF_LIFE_DAYS = 21;

export interface MasteryConcept {
  id: string;
  topic: string | null;
}

export interface MasteryAttempt {
  conceptId: string;
  correct: boolean;
  answeredAt: string;
}

export interface TopicMastery {
  topic: string;
  concepts: number;
  attempts: number;
  correct: number;
  /** 0-1, or null when there are fewer than MIN_MASTERY_ATTEMPTS attempts. Nothing is invented below that. */
  mastery: number | null;
  insufficientData: boolean;
}

export const NO_TOPIC = '(no topic)';

export function computeTopicMastery(concepts: MasteryConcept[], attempts: MasteryAttempt[], now: Date): TopicMastery[] {
  const topicOf = new Map(concepts.map(c => [c.id, c.topic?.trim() || NO_TOPIC]));
  const rows = new Map<string, { concepts: Set<string>; attempts: number; correct: number; weight: number; weighted: number }>();
  const row = (topic: string) => {
    const existing = rows.get(topic);
    if (existing) return existing;
    const fresh = { concepts: new Set<string>(), attempts: 0, correct: 0, weight: 0, weighted: 0 };
    rows.set(topic, fresh);
    return fresh;
  };
  for (const c of concepts) row(topicOf.get(c.id)!).concepts.add(c.id);
  for (const a of attempts) {
    const topic = topicOf.get(a.conceptId);
    if (!topic) continue;
    const r = row(topic);
    const ageDays = Math.max(0, (now.getTime() - new Date(a.answeredAt).getTime()) / 86_400_000);
    const w = Math.pow(0.5, ageDays / MASTERY_HALF_LIFE_DAYS);
    r.attempts += 1;
    r.correct += a.correct ? 1 : 0;
    r.weight += w;
    r.weighted += a.correct ? w : 0;
  }
  return [...rows.entries()]
    .map(([topic, r]): TopicMastery => {
      const insufficientData = r.attempts < MIN_MASTERY_ATTEMPTS;
      return {
        topic,
        concepts: r.concepts.size,
        attempts: r.attempts,
        correct: r.correct,
        mastery: insufficientData || r.weight === 0 ? null : Math.round((r.weighted / r.weight) * 1000) / 1000,
        insufficientData,
      };
    })
    .sort((a, b) => (a.mastery ?? 2) - (b.mastery ?? 2) || a.topic.localeCompare(b.topic));
}
