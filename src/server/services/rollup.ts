/**
 * Application service: concept-level predicted recall rolled up to topic and subject.
 */

import { getTargetRecall } from '@/server/repositories/profile';
import { getConceptsWithForecasts } from '@/server/services/forecasting';
import { rollUp, type SubjectRollup } from '@/domain/forecasting/rollup';

export async function getRecallRollup(): Promise<{ targetRecall: number; subjects: SubjectRollup[] }> {
  const [targetRecall, rows] = await Promise.all([getTargetRecall(), getConceptsWithForecasts()]);
  const subjects = rollUp(
    rows.map(({ concept, recallState, forecast }) => ({
      id: concept.id,
      subject: concept.subject,
      topic: concept.topic,
      probability: forecast.probability,
      repetitionCount: recallState.repetitionCount,
      lapseCount: recallState.lapseCount,
    })),
    targetRecall
  );
  return { targetRecall, subjects };
}
