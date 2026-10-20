/**
 * Application service: a mixed test across subjects, weighted towards what the model expects you to forget.
 */

import { buildMixedTest, type MixedConcept } from '@/domain/assessment/mixed';
import type { PoolEntry } from '@/domain/assessment/types';
import { getTargetRecall } from '@/server/repositories/profile';
import { listDefinedTermsBySource, listRecentQuestionTypes } from '@/server/repositories/mixed';
import { listSubjectDefinedTerms } from '@/server/repositories/sources';
import { getConceptsWithForecasts } from '@/server/services/forecasting';
import type { MixedTestResponse, UUID } from '@/types';

const DEFINE_PREFIX = 'define: ';

export async function buildMixedTestForUser(params: { size: number; subjects: string[]; seed?: number }): Promise<MixedTestResponse> {
  const [targetRecall, rows] = await Promise.all([getTargetRecall(), getConceptsWithForecasts()]);

  const counts = new Map<string, number>();
  for (const { concept } of rows) counts.set(concept.subject, (counts.get(concept.subject) ?? 0) + 1);
  const subjectsAvailable = [...counts.entries()].map(([subject, concepts]) => ({ subject, concepts })).sort((a, b) => a.subject.localeCompare(b.subject));

  const wanted = new Set(params.subjects);
  const eligible = rows.filter(r => wanted.size === 0 || wanted.has(r.concept.subject));
  const seed = params.seed ?? Math.floor(Math.random() * 2_147_483_647);

  // Only the concepts that could be picked need their terms / history; fetch for the whole eligible set in two queries.
  const sourceIds = [...new Set(eligible.flatMap(r => (r.concept.sourceId ? [r.concept.sourceId as UUID] : [])))];
  const [termsBySource, recentTypes] = await Promise.all([
    listDefinedTermsBySource(sourceIds),
    listRecentQuestionTypes(eligible.map(r => r.concept.id as UUID)),
  ]);

  const concepts: MixedConcept[] = eligible.map(({ concept, recallState, forecast }) => {
    const prompt = concept.prompt.trim();
    const termName = prompt.toLowerCase().startsWith(DEFINE_PREFIX) ? prompt.slice(DEFINE_PREFIX.length).trim().toLowerCase() : null;
    const row = concept.sourceId && termName ? termsBySource.get(`${concept.sourceId}|${termName}`) : undefined;
    return {
      conceptId: concept.id,
      subject: concept.subject,
      topic: concept.topic,
      probability: forecast.probability,
      lapseCount: recallState.lapseCount,
      prompt: concept.prompt,
      answer: concept.answer,
      term: row
        ? { termId: row.id, conceptId: concept.id, term: row.term, definition: row.definition, sectionId: row.sectionId, location: row.location }
        : null,
    };
  });

  // Wrong options come from the same subject's defined terms.
  const pools: Record<string, PoolEntry[]> = {};
  for (const subject of new Set(concepts.filter(c => c.term).map(c => c.subject))) {
    pools[subject] = await listSubjectDefinedTerms(subject);
  }

  return {
    questions: buildMixedTest({ concepts, pools, recentTypes, size: params.size, seed }),
    seed,
    targetRecall,
    subjectsAvailable,
    conceptsConsidered: concepts.length,
  };
}
