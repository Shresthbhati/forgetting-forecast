/**
 * Forecast evaluation - Domain layer
 * Pure rules for checking logged forecasts against later observed attempts.
 */

/** Horizons logged after every review: 1 day, 7 days, 30 days. */
export const FORECAST_HORIZONS_HOURS = [24, 168, 720] as const;

export type LoggedForecast = {
  id: string;
  generatedAt: string;
  targetAt: string;
  horizonHours: number;
  predictedProbability: number;
};

export type ObservedAttempt = {
  id: string;
  answeredAt: string;
  actualCorrectness: boolean;
};

export type ForecastEvaluationResult = {
  forecastId: string;
  attemptId: string;
  observedCorrect: boolean;
  absError: number;
};

/**
 * Window rule: a later attempt evaluates a forecast when it happens within +-50% of the forecast's
 * horizon around the forecast's target time. A 7d forecast is therefore evaluated by an attempt made
 * between 3.5d and 10.5d after it was generated. The attempt must come after the forecast was
 * generated, so the review that produced a forecast never evaluates it.
 */
export function isWithinEvaluationWindow(forecast: LoggedForecast, answeredAt: string): boolean {
  const answered = new Date(answeredAt).getTime();
  const generated = new Date(forecast.generatedAt).getTime();
  const target = new Date(forecast.targetAt).getTime();
  const tolerance = 0.5 * forecast.horizonHours * 3_600_000;
  return answered > generated && Math.abs(answered - target) <= tolerance;
}

/** Evaluates every still-pending forecast the attempt falls inside the window of. Each forecast is evaluated at most once. */
export function evaluateForecasts(pending: LoggedForecast[], attempt: ObservedAttempt): ForecastEvaluationResult[] {
  return pending
    .filter(f => isWithinEvaluationWindow(f, attempt.answeredAt))
    .map(f => ({
      forecastId: f.id,
      attemptId: attempt.id,
      observedCorrect: attempt.actualCorrectness,
      absError: Math.abs(f.predictedProbability - (attempt.actualCorrectness ? 1 : 0)),
    }));
}

export type ForecastStatus = 'pending' | 'evaluated' | 'expired';

/** Pending until evaluated; expired once the evaluation window has closed without an attempt. */
export function forecastStatus(forecast: LoggedForecast, evaluated: boolean, now: Date): ForecastStatus {
  if (evaluated) return 'evaluated';
  const windowEnd = new Date(forecast.targetAt).getTime() + 0.5 * forecast.horizonHours * 3_600_000;
  return now.getTime() > windowEnd ? 'expired' : 'pending';
}
