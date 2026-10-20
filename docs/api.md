# API reference

All routes live in `src/app/api/` and are wrapped by `createApiHandler` (`src/server/errors`). Every response carries an `X-Request-ID` header. Authentication is the Supabase session cookie; there are no API keys. The server uses the **anon key plus the user's cookie**, so row-level security applies to every query.

## Conventions

**Error shape** (every route, every failure):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "page: Too big", "requestId": "req_1792..._ab12cd34", "details": {} } }
```

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body or query failed validation (also: malformed JSON, session not in progress) |
| 401 | `UNAUTHORIZED` | No valid session |
| 403 | `FORBIDDEN` | Not allowed (e.g. deleting the demo account) |
| 404 | `NOT_FOUND` | Missing, or it belongs to another user (the two are deliberately indistinguishable) |
| 409 | `CONFLICT` | e.g. finishing a session twice |
| 429 | `RATE_LIMITED` | Write flood (about 60 writes/minute/user/scope) |
| 500 | `INTERNAL_ERROR` | Unexpected failure (details are logged server-side, never returned) |
| 503 | `SERVICE_UNAVAILABLE` | e.g. demo account not configured |

Timestamps are ISO 8601 UTC. Probabilities are 0–1. Confidence is stored 0–1 and **submitted as a 1–5 `confidenceLevel`**.

**Logging**: structured JSON lines with `requestId`, `route`, `method`, `code`, `status`. Prompts, answers and tokens are never logged.

## Health

### `GET /api/health` (public)
`200` `{ status: "healthy" | "degraded", timestamp, version, environment, checks: { database, supabase } }`

## Account

### `GET /api/me`
`200` `{ id, email, displayName, preferredTimezone, dailyGoal, targetRecall, isDemo }`

### `PATCH /api/me`
Body (all optional, unknown keys rejected): `{ displayName: string|null, preferredTimezone: string, dailyGoal: 1-500, targetRecall: 0.5-0.99 }` → `200` the updated profile. `isDemo` cannot be set (`400`; a database trigger also enforces it).

### `GET /api/me/export`
`200` a JSON **attachment** (`Content-Disposition`) with `exportedAt`, `profile`, and every row of `concepts`, `recall_states`, `retrieval_attempts`, `study_sessions`, `forecast_log`, `forecast_evaluations`.

### `DELETE /api/me`
Body `{ "confirm": "DELETE" }`. Deletes the auth user (service-role client); foreign-key cascades remove all data. `204`. The demo account returns `403`. Rate limited.

### `POST /api/demo-login` (public)
Signs the public demo account in **server-side** using `DEMO_PASSWORD`, sets the session cookies, returns `{ ok: true }`. `503` if not configured, `401` if the demo user hasn't been seeded.

## Concepts

### `GET /api/concepts?subject=&includeArchived=&page=&pageSize=`
`200` `{ concepts: [{ ...concept, recallState }], page, pageSize }` (`pageSize` ≤ 100).

### `POST /api/concepts`
Body `{ subject, topic?, prompt, answer, explanation?, difficulty: 1-5, tags?, sourceReference? }` → `201` the concept (a recall state is created with a 24h prior). Rate limited.

### `GET /api/concepts/:id` · `PATCH /api/concepts/:id` · `DELETE /api/concepts/:id`
`GET` → `{ ...concept, recallState }`. `PATCH` takes any subset of the create fields (+ `archivedAt`). `DELETE` → `204` (cascades attempts, forecasts).

### `GET /api/concepts/:id/detail`
One call for the concept page:

```json
{
  "concept": {}, "recallState": {},
  "forecast": { "probability": 0.61, "dueInHours": 0, "status": "Review soon", "evidence": "…" },
  "horizonForecasts": [ { "horizonHours": 24, "forecast": {} }, { "horizonHours": 168, "forecast": {} }, { "horizonHours": 720, "forecast": {} } ],
  "attempts": [ /* last 50, newest first */ ],
  "priority": { "nextReviewAt": "…", "priorityScore": 0.69, "factors": { "estimatedRecallProbability": 0.61, "hoursSinceLastReview": 0.4, "isOverdue": true, "uncertaintyLevel": "low", "userPriority": 0 } }
}
```
`priority.factors` are the scheduler's real inputs. `404` for another user's id.

## Reviews and sessions

### `POST /api/reviews`
```json
{
  "conceptId": "uuid",
  "sessionId": "uuid | null",
  "clientRequestId": "uuid (optional idempotency key)",
  "actualCorrectness": true,
  "confidenceLevel": 4,
  "responseLatencyMs": 4200,
  "reviewMode": "due | practice | experiment"
}
```
- `confidenceLevel` is 1–5; the server converts it to 0–1 (`confidenceFromLevel`, one place). `selfReportedConfidence` (0–1) is accepted for legacy callers and ignored when `confidenceLevel` is present.
- `responseLatencyMs` must be 0–1,800,000 (30 min). Timestamps are set by the server.
- A client-sent prediction is **ignored**: the server computes it from the stored state before applying the outcome.
- `sessionId` must belong to you and be `in_progress` (otherwise `404` / `400`).

`201` (or `200` when `duplicate`) → `{ attempt, concept, updatedRecallState, forecast, nextReviewAt, duplicate }`. Re-posting the same `clientRequestId` returns the original attempt with `duplicate: true` and writes nothing. After the write, 1d/7d/30d forecasts are logged and earlier forecasts are evaluated (best effort; a logging failure never loses the review).

### `GET /api/reviews?conceptId=&result=correct|incorrect&from=&to=&page=&pageSize=`
`200` `{ items: [{ ...attempt, conceptPrompt, conceptSubject }], total, page, pageSize }`, newest first, `pageSize` ≤ 100.

### `POST /api/sessions` · `PATCH /api/sessions/:id`
`POST { mode }` → `201 { sessionId }`. `PATCH { status: "completed" | "abandoned" }` → the session; `conceptCount` and `summary { total, correct, averageConfidence }` are **computed server-side from that session's attempts**. `409` if already finished, `404` for another user's id. An abandoned session keeps its attempts.

## Sources (uploaded study material)

Node runtime. Writes are rate-limited (about 60/minute/user). See `docs/VISION_PLAN.md`.

### `POST /api/sources` (multipart)
Fields: `file` (PDF, PPTX, DOCX, TXT, MD; max 20 MB, 300 pages/slides), `subject` (1–100 chars), `title?`. The type is decided by extension **and** the file's leading bytes. `201` `{ source, duplicate: false }` when processed; `200` `{ source, duplicate: true }` when the same file (sha256) was uploaded before. A file that can't be read still returns `201` with `source.status = "failed"` and a readable `source.error` (e.g. `No text layer — OCR not supported yet`); re-uploading it retries. `400` for a missing/unsupported/mismatched file, blank subject or a file over the limit; `401` signed out.

### `GET /api/sources`
`200` `{ sources: [{ id, subject, title, kind, byteSize, status, error, unitCount, createdAt, ... }] }`, newest first.

### `GET /api/sources/:id`
`200` `{ source, sections: [{ id, ordinal, level, heading, text, location, charCount }], terms: [{ id, sectionId, term, definition, location, score }], addedTermIds }`. `terms[].definition` is `null` when the term was picked by frequency/heading only. `404` for an unknown or another user's id.

### `DELETE /api/sources/:id`
`204`. Removes the row, its sections and terms, and the stored file. Concepts already made from it are kept but lose their source link.

### `POST /api/sources/:id/concepts`
Body `{ items: [{ type: "term", termId } | { type: "passage", sectionId, prompt, answer }], difficulty?: 1-5 (default 3) }`, 1–100 items. `201` `{ created: Concept[], skipped: [{ termId?, sectionId?, reason }] }`. A term becomes `Define: <term>` → its definition sentence (or, with no detected definition, the first sentence that mentions it; skipped if there is none). Each concept stores `sourceId`, `sourceSectionId`, `sourceLocation` and `sourceReference` ("Title, p. 12"). Repeating a term is skipped with `reason: "Already added"`.

`GET /api/review-queue` items and `GET /api/concepts/:id` carry `concept.sourceReference` / `sourceId` / `sourceLocation` for these concepts.

## Queue, forecasts, dashboard

### `GET /api/review-queue?mode=due|practice|experiment&subject=&maxItems=`
`200` `{ items: [{ concept, recallState, forecast, priorityScore, schedulingFactors }] }`, highest priority first. `practice` lists every active concept.

### `GET /api/forecasts/:conceptId?horizonsHours=24,168`
`200` `{ concept, recallState, currentForecast, horizonForecasts }` (computed on demand; not logged).

### `GET /api/forecasts/:conceptId/log`
`200` `{ forecasts: [{ id, conceptId, generatedAt, horizonHours, targetAt, predictedProbability, modelVersion, status: "pending"|"evaluated"|"expired", evaluation: { attemptId, observedCorrect, absError, evaluatedAt } | null }] }`. Rows are immutable. A forecast is evaluated by a later attempt made within ±50% of its horizon around its target time (a 7-day forecast: an attempt 3.5–10.5 days after it was made), at most once.

### `GET /api/dashboard`
`200` `{ totalActiveConcepts, dueConcepts, reviewsCompletedToday, reviewsCompletedThisWeek, meanEstimatedRecall, nextRecommendedReviews, recentActivity }`. `dueConcepts` counts concepts whose scheduled next review has passed.

## Analytics

### `GET /api/analytics`
Existing fields are unchanged (`correctnessByTopic`, `correctnessByElapsedInterval`, `reviewFrequency`, `lapseFrequency`, `timePerRetrieval`, `forecastCalibration`, `brierScore`, `insufficientData`, `dataPoints`). Added:

| Field | Shape |
|---|---|
| `immediateVsDelayed` | `{ immediate: { n, accuracy }, delayed: { n, accuracy }, insufficientData }`: previous review under 24h ago vs 72h or more ago |
| `calibration` | `{ buckets: [{ predictedRange, predictedMean, observedAccuracy, count }], brierScore, n, insufficientData }` |
| `baseline` | `{ n, modelBrier, historicalRateBrier, fixedHalfLifeBrier, bestBaseline, modelBeatsBaseline, brierImprovement, insufficientData }` |
| `forecastLog` | `{ evaluated, pending, byHorizon: [{ horizonHours, evaluated, meanAbsError }], insufficientData }` (`pending` = logged but not yet evaluated) |

Every metric is `null` (with `insufficientData: true`) below **10** observations. Baselines: (a) your correctness rate over strictly *earlier* attempts (Laplace-smoothed), (b) one fixed 24h half-life for every concept. First reviews (no elapsed time) are excluded from the model **and** both baselines so the comparison is like-for-like. `brierImprovement` > 0 means the model is better.

## Auth callback (not JSON)

`GET /auth/callback?code=&next=`: exchanges the code for a session and redirects. `next` is honoured only if it is a same-site relative path; `//evil.com`, `/\evil.com`, `@evil.com` and absolute URLs fall back to `/`.
