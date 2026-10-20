/**
 * Application service: prerequisite links between a source's defined terms, and probe questions for them.
 */

import { prerequisiteReport, type ConceptStatus, type GraphTerm } from '@/domain/knowledge/graph';
import { generateQuestions } from '@/domain/assessment/generators';
import type { TermInput } from '@/domain/assessment/types';
import { NotFoundError } from '@/server/errors';
import { getConcept } from '@/server/repositories/concepts';
import { getTargetRecall } from '@/server/repositories/profile';
import * as sources from '@/server/repositories/sources';
import { getConceptsWithForecasts } from '@/server/services/forecasting';
import type { PrerequisitesResponse, UUID } from '@/types';

const DEFINE_PREFIX = 'define: ';
const MAX_PROBES = 5;

const termPromptKey = (term: string) => `${DEFINE_PREFIX}${term}`.toLowerCase();

export async function getConceptPrerequisites(conceptId: UUID): Promise<PrerequisitesResponse> {
  const concept = await getConcept(conceptId);
  if (!concept) throw new NotFoundError('Concept');
  const prompt = concept.prompt.trim();
  if (!concept.sourceId || !prompt.toLowerCase().startsWith(DEFINE_PREFIX)) {
    return { available: false, unavailableReason: 'This concept was not made from a defined term in a source, so there is no prerequisite graph for it.' };
  }
  const sourceId = concept.sourceId as UUID;

  const [sections, terms, sourceConcepts, forecasts, target, subjectTerms] = await Promise.all([
    sources.listSections(sourceId),
    sources.listTerms(sourceId),
    sources.listSourceConcepts(sourceId),
    getConceptsWithForecasts(),
    getTargetRecall(),
    sources.listSubjectDefinedTerms(concept.subject),
  ]);

  const ordinalOf = new Map(sections.map(s => [s.id, s.ordinal]));
  const defined = terms.filter(t => t.definition);
  const graphTerms: GraphTerm[] = defined.map(t => ({ id: t.id, term: t.term, definition: t.definition, sectionOrdinal: (t.sectionId && ordinalOf.get(t.sectionId)) || 0 }));

  const forecastById = new Map(forecasts.map(f => [f.concept.id, f]));
  const conceptIdByPrompt = new Map(sourceConcepts.map(c => [c.prompt.trim().toLowerCase(), c.id]));
  const statuses: Record<string, ConceptStatus | undefined> = {};
  for (const t of defined) {
    const id = conceptIdByPrompt.get(termPromptKey(t.term));
    const f = id ? forecastById.get(id) : undefined;
    if (id && f) statuses[t.id] = { conceptId: id, probability: f.forecast.probability, lapseCount: f.recallState.lapseCount, repetitionCount: f.recallState.repetitionCount };
  }

  const focusName = prompt.slice(DEFINE_PREFIX.length).trim().toLowerCase();
  const focus = defined.find(t => t.term.toLowerCase() === focusName);
  if (!focus) return { available: false, unavailableReason: 'The term behind this concept is no longer in its source.' };

  const report = prerequisiteReport({ termId: focus.id, terms: graphTerms, statuses, target });

  // Probe questions: one per tracked prerequisite that needs a check, so each answer is recorded against that prerequisite.
  const probeTerms: TermInput[] = report.prerequisites
    .filter(p => p.needsCheck && p.conceptId)
    .slice(0, MAX_PROBES)
    .map(p => {
      const t = defined.find(x => x.id === p.termId)!;
      return { termId: t.id, conceptId: p.conceptId, term: t.term, definition: t.definition, sectionId: t.sectionId, location: t.location };
    });
  const questions = generateQuestions({ terms: probeTerms, pool: subjectTerms, formulas: [], seed: Math.floor(Math.random() * 2_147_483_647) });

  return {
    available: true,
    focus: { conceptId: concept.id, term: focus.term },
    struggling: report.struggling,
    prerequisites: report.prerequisites,
    dependents: report.dependents,
    questions,
  };
}
