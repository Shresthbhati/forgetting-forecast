# Vision plan: from "type a card" to "upload what you study"

## Context

The app started as a flashcard forecaster where users type every card themselves. A half-life model (`src/domain/forecasting/engine.ts`) predicts recall, logs 1-, 7- and 30-day forecasts, and later checks them against real results; `/analytics` shows how well they matched (calibration and baselines). That checking is the most valuable part of the repo and stays.

The new direction changes the starting point: users **upload what they study**. The app pulls structure and key terms out of documents, writes tests from them, and then mixes old and new material across subjects, weighting those tests toward concepts predicted to fade.

## Decisions

- **No external LLM.** We build our own engine for extraction and question generation: rule-based, pure TypeScript, running on our server. A `QuestionGenerator` interface lets a local model be added later, but nothing depends on one.
- **Documents first.** YouTube and playlists come in a later phase.
- **We state the limit openly.** Rules can reliably produce these question types:
  - definition recall
  - cloze (fill-in-the-blank)
  - matching a term to its definition as a multiple-choice question
  - true/false
  - numericals from formulas found in the text

  Rules cannot reliably write "explain why" or application questions. Those stay user-written, or wait for a plugged-in model later. The UI labels generated items for what they are (e.g. "generated from p. 12") and never presents them as more.

## What stays as-is

- The forecasting engine, scheduler, forecast log, evaluation, calibration and baselines (`src/domain/forecasting/*`, `src/domain/analytics/*`).
- The atomic, idempotent review write `submit_review_tx` (`supabase/migrations/003`), plus `/review`, `/analytics` and `/history`.
- The layering: route → service → repository → domain; `createApiHandler`, the zod schemas in `src/server/validation/schemas.ts`, error handling, rate limiting, RLS conventions and `node --test`.
- The wording "predicted recall probability" everywhere.

## Roadmap

| # | Phase | Status |
|---|---|---|
| 1 | Foundation: uploads, extraction, outline, key terms, concepts linked to their page/slide | **built** (see below) |
| 2 | Assessment engine (our own) | **built** (see below) |
| 3 | Memory engine upgrades | **built** (see below) |
| 4 | Mixed tests across subjects | **built** (see below) |
| 5 | Knowledge graph and exam mode | **built** (see below) |
| 6 | YouTube (captions only) | **built** (see below) |

### 1. Foundation (built)

- Upload PDF, PPTX, DOCX and TXT/MD files.
- Extract text and keep the page or slide each piece came from.
- Build a section outline and pick out candidate key terms with their definition sentences.
- Organise everything by subject.
- "Make a concept from this passage", linking back to the page or slide.

### 2. Assessment engine (our own) (built)

- Rule-based generators:
  - definition recall
  - cloze
  - term↔definition multiple choice, with wrong options taken from other terms in the same subject at a similar length
  - true/false made by swapping definitions
  - numericals from formulas like `F = m·a`, using random values and a computed answer
- Quality gates: minimum sentence length, no question stems that are only pronouns, deduplication.
- Grading:
  - Multiple choice is graded as an exact match.
  - Short answers are graded by normalised word overlap plus edit distance.
  - Every short-answer grade shows a "graded automatically — override?" step before it is saved as `actual_correctness`.
- A quiz after reading each section, and per-topic mastery computed from existing attempts.

### 3. Memory engine upgrades

- Wire `target_recall` into scheduling; it is currently fixed at 0.8.
- Add question type and topic as model features.
- Roll concept-level recall up to topic and subject level.
- Keep checking every change against the baselines.

### 4. Mixed tests across subjects

- Interleaved sessions weighted by (1 − predicted recall) and lapse count.
- Prefer a different generated item for the same concept (new numbers, a different blank) so the test checks understanding rather than memorised wording.

### 5. Knowledge graph and exam mode

- Prerequisite links: term A appears inside term B's definition, plus section order.
- "Struggling with B → check A" probe questions.
- An exam date plus syllabus coverage produces a revision plan.

### 6. YouTube (captions only)

- Captions only, as another source type, with timestamps as locations.
- A clear "no transcript available" failure.
- A playlist is a group of sources.

## Phase 1 in detail

### Schema (`supabase/migrations/007_sources.sql`, additive only)

- `sources`: `id`, `user_id`, `subject`, `title`, `kind` (`pdf|pptx|docx|text`), `storage_path`, `byte_size`, `sha256`, `status` (`processing|ready|failed`), `error`, `unit_count` (pages or slides), timestamps. **Unique on (`user_id`, `sha256`)**, so re-uploading the same file is idempotent.
- `source_sections`: `id`, `source_id`, `user_id`, `ordinal`, `level`, `heading`, `text`, `location` JSONB (`{page}`, `{slide}`, `{pageStart,pageEnd}`, `{slideStart,slideEnd}`, or `{}` for Word/text), `char_count`.
- `source_terms`: `id`, `source_id`, `section_id`, `user_id`, `term`, `definition` (nullable), `location` JSONB, `score`.
- `concepts`: nullable `source_id`, `source_section_id` (both `ON DELETE SET NULL`) and `source_location` JSONB. `source_reference` (existing text column) carries the label, e.g. "DBMS Notes, p. 12".
- Private Storage bucket `sources`; files at `{user_id}/{source_id}.{ext}`; policy `(storage.foldername(name))[1] = auth.uid()::text`.
- RLS on all three tables. Insert policies also check the parent source (and section) belongs to the user, as in 006; the `concepts` insert/update policies now refuse a `source_id` / `source_section_id` the user doesn't own.
- `ingest_source_tx(p_source_id, p_unit_count, p_sections, p_terms)`: `SECURITY INVOKER`, `anon` revoked. Writes sections and terms and flips the source to `ready` in one transaction. It refuses a source that already has sections.

### Domain (`src/domain/ingestion/`, pure functions, unit-tested)

- `normalize.ts`: repairs hyphenation and whitespace; strips headers/footers (a line, digits masked, that repeats on more than 50% of pages; needs ≥ 3 pages) and page numbers.
- `segment.ts`: pages/slides → sections by detecting headings (Markdown `#`, numbered `1.2 Title`, short ALL-CAPS lines, slide titles); merges sections under 200 chars; caps sections at 6,000 chars; reflows wrapped lines.
- `terms.ts`: candidate phrases (1–4 words split at stopwords) scored by TF-IDF across the source's sections (plus the subject's other sources), boosted for headings and definitions. Definition patterns: `X is/are a|an|the …`, `X refers to / is defined as / is called / means …`, `X: …`, `X — …`. Rejects pronoun stems, label words ("Note:") and questions.
- `kind.ts` (type + magic-byte detection), `location.ts` ("p. 12", "slides 3–5").

### Extraction (`src/server/ingestion/extract.ts`, Node runtime)

PDF `unpdf`; DOCX `mammoth` (HTML, so headings survive); PPTX `jszip` reading each slide's `<a:t>` runs, the title from the title placeholder, slides in presentation order; TXT/MD as UTF-8. Limits: 20 MB, 300 pages/slides, 3M characters, zip-bomb guard. A PDF with no text layer is `failed` with "No text layer — OCR not supported yet"; it is never reported as a success.

### Server

`repositories/sources.ts` → `services/sources.ts`. Pipeline: hash → store → extract → split → terms → `ingest_source_tx`. On failure the source gets `status = failed` and a readable message. Re-uploading a failed file retries it. Routes (all validated with zod; writes rate-limited):

| Route | Purpose |
|---|---|
| `POST /api/sources` | multipart upload |
| `GET /api/sources` | list |
| `GET /api/sources/[id]` | sections, terms, `addedTermIds` |
| `DELETE /api/sources/[id]` | row, sections, terms and the stored file |
| `POST /api/sources/[id]/concepts` | concepts from terms or passages, keeping the source location |

Account export now includes the three new tables; account deletion also removes the user's stored files.

### UI

`/sources` (drag-and-drop with progress, status pills, grouped by subject, empty/error states) and `/sources/[id]` (outline with page/slide numbers, reader, key terms with "Add as concept" / "Add all", "Make a concept from this passage"). A sidebar entry; "From: title, p. 12" on the concept page and the review card. Terms and definitions are labelled as picked out by rules.

## Phase 2 in detail

No schema change: quiz answers are ordinary attempts written through the existing `POST /api/reviews` (`submit_review_tx`), with the question type and grading method in `retrieval_attempts.metadata`.

### Domain (`src/domain/assessment/`, pure, unit-tested)

- `generators.ts`: a `QuestionGenerator` interface (the seam for a local model later) and the built-in `ruleBasedGenerator`. One question per term, rotating through the types; if a type can't be made for a term the next is tried.
  - **definition recall**: "Define: term", graded against the definition body.
  - **cloze**: blanks the term (with its parenthesised acronym) or its longest key word out of the defining sentence; the acronym and full form are accepted answers.
  - **multiple choice**: term → definition. Wrong options are *other terms' definitions from the same subject, closest in length*; never one that names the answer, never a duplicate. Needs 3 other defined terms in the subject, otherwise the term gets another type.
  - **true/false**: the sentence as written, or with the term swapped for another term's.
  - **numerical**: `formula.ts` finds `F = m·a`, `v = u + at`, `E = mc^2` in the text and evaluates them with a small parser (no `eval`); random values, computed answer, 1% tolerance. Only results exact to two decimals are used.
- `gates.ts`: quality gates: minimum stem length, no stems that are only pronouns/function words once the blank is removed, a minimum definition-body size, deduplication.
- `grading.ts`: multiple choice and true/false are an exact match (final). Short answers: exact, else edit-distance similarity ≥ 0.85 (typos), else normalised word overlap of key words (all of them for a short expected answer, ≥ 60% for a long one). Numbers: within tolerance, units ignored.
- `mastery.ts`: per-topic (section heading) mastery = recency-weighted share of correct attempts (21-day half-life); `null` and `insufficientData` below 5 attempts.

### Server and UI

- `GET /api/sources/[id]/quiz?sectionId=&seed=`: builds a quiz for one section (max 10 questions).
- `GET /api/sources/[id]/mastery`: per-topic mastery for the concepts made from the source.
- `/sources/[id]/quiz?section=`: the quiz. "Quiz this section" is in the reader; a Mastery tab is on the source page.
- **Every short-answer and numeric grade shows "Graded automatically — override?"** with the automatic verdict preselected; the verdict you leave selected is what is saved as `actual_correctness`, and the metadata records `autoVerdict` and `overridden`.
- Every question is labelled "Generated from p. N".

### Deliberate limits

- The quiz covers terms that **already have a concept**, so every answer is a real attempt feeding the forecasts. Terms without one are listed, with an "Add N terms and quiz me" button.
- **Numericals are practice-only**: they come from a formula, not a concept, so they are not recorded.
- Grading is a heuristic. It will mark some right answers wrong and a few wrong ones right, which is why the override step is always shown.
- Question type is stored in attempt metadata but is **not** a model feature yet (phase 3).
- Rules still can't write "explain why" or application questions.

## Phase 3 in detail: memory engine

Migrations: none.

- **Target recall is wired in.** `target_recall` (Settings, 0.5–0.99) now drives the scheduler: a concept's next review time and its Strong / Review soon / Due now status are planned around the user's target instead of a fixed 0.8. The default is still 0.8 for users who never changed it (`DEFAULT_TARGET_RECALL`). The model's *predictions* are unchanged; only the planning threshold moves.
- **Roll-up** (`domain/forecasting/rollup.ts`, `GET /api/rollup`): mean predicted recall, concepts below target, reviewed count and lapses per topic and per subject, plus the weakest concept. Shown as the **Memory map** on the dashboard. Concepts never reviewed sit on the model's starting estimate, and the panel says so.
- **Feature challenger** (`domain/forecasting/featureModel.ts`, `feature-adjusted-v2`): adds question type and topic as features by learning a shrunken calibration ratio per feature value from *earlier* attempts only (walk-forward). It is evaluated on the same attempts as v1 and the two baselines (Model Lab and Analytics) and is **evaluation only**: scheduling still uses `exponential-half-life-v1`. It may only be called better than v1 after 30 scored attempts and a lower Brier score.

## Phase 4 in detail: mixed tests

Migrations: none. Answers are ordinary attempts through `POST /api/reviews` (`reviewMode: 'practice'`, metadata `source: 'mixed-test'`).

- `domain/assessment/mixed.ts`: concepts are sampled **without replacement, weighted by (1 − predicted recall) × (1 + 0.3 × lapses, capped at 6 lapses) + a small floor** (Efraimidis–Spirakis), then **interleaved by subject** (never more than two in a row from one subject while others remain).
- For a concept made from a source term, the question is a *generated* item (cloze, multiple choice, true/false) and avoids the types asked most recently, so the same concept doesn't repeat the same wording. Hand-written concepts, and any concept the generators can't handle, get the usual recall question. Every item is labelled by origin.
- `GET /api/mixed-test?size=&subjects=&seed=` and `/test`: size (5–20), subject filter, "Draw a different set", then the same quiz runner as phase 2 including the grading-override step.

## Phase 5 in detail: knowledge graph and exam mode

Migration `008_exams.sql`: an `exams` table (user, subject, name, `exam_date`) with four RLS policies.

- **Prerequisites** (`domain/knowledge/graph.ts`, `GET /api/concepts/[id]/prerequisites`): term A is a prerequisite of term B when A's name appears in B's definition **and** A is defined in the same or an earlier section of the same source (names that mention each other within a section are ambiguous, so neither edge is kept; plural forms match). Only defined terms take part.
- **"Struggling with B → check A"**: if B is below target or has lapsed, the concept page lists its prerequisites that are untracked, never reviewed, below target or lapsed, and offers `/concepts/[id]/check`, a quiz with one generated probe per tracked prerequisite. Answers are recorded against the prerequisite.
- **Exam mode** (`domain/knowledge/exam.ts`, `/exams`): the syllabus is the *sections of the user's sources for the subject*. A topic is covered once a concept exists for it. The plan spreads "learn" tasks for uncovered topics over the first 60% of the days, gives each covered topic 1–3 review sessions (more when predicted recall on exam day is low, plus one a couple of days after it is learned) and ends with a mock test on the last day. Days heavier than 1.5 × the daily goal are flagged; too many uncovered topics for the days left produces a warning. Dates are plain UTC calendar days.

## Phase 6 in detail: YouTube (captions only)

Migration `009_youtube_sources.sql`: `source_groups` (RLS), `sources.source_url`, `sources.group_id`, `kind` widened to include `youtube`, and the `sources` insert/update policies now also require a group to belong to the same user.

- **No audio or video is downloaded and nothing is transcribed.** `server/ingestion/youtube.ts` fetches the watch page, reads the embedded player response, picks a caption track (human-made in English, then automatic, then any), fetches it as `json3` (falling back to XML) and the domain layer (`domain/ingestion/youtube.ts`) turns the cues into one-minute units. Sections are consecutive time windows of about 1,500 characters headed by their range ("2:10–4:30") and located by seconds, so concepts say "From: title, 2:10–4:30".
- **Clear failures**: "No transcript available for this video", sign-in required, removed, live stream with no recording, longer than 6 hours, YouTube unreachable or answering with an error. The source is kept as `failed` with that message, and importing the same link again retries it.
- **Safety**: only https `*.youtube.com` caption URLs are ever fetched (SSRF guard); 15 s timeouts; 4 MB page and 3 MB caption caps; the video id is validated before use.
- **Playlists are groups**: a playlist link creates a `source_groups` row and imports up to 25 of its videos one after another, each succeeding or failing on its own. Importing a video twice returns the existing source (idempotent on a hash of `youtube:<id>`).
- `POST /api/sources/youtube { url, subject }`; `/sources` has an "Add a YouTube link" card; the source page has "Open on YouTube" and "Watch from m:ss" links per section.

### Limits of phases 3–6

- The feature challenger is not used for scheduling. With little data its ratios stay near 1 and it will not beat v1; that is the intended behaviour.
- The graph is name matching, not understanding: a term that is merely *mentioned* in a definition becomes a prerequisite, and a prerequisite expressed with a synonym is missed. The panel says "check they make sense".
- Exam syllabus quality depends on the section outline; "predicted recall on exam day" assumes no further review.
- **YouTube reads an undocumented page structure, so it can stop working whenever YouTube changes it** (or starts requiring extra tokens for some videos). It could not be run against the real site in the build environment, only against fixtures and a mocked `fetch`. Automatic captions have no punctuation and mishear words, so sentence-based definition detection is rougher than on documents; the UI says so.
- Rules still can't write "explain why" or application questions; mixed tests are only as varied as the definitions in the sources.

## Known limits of phase 1

- Definition detection is pattern matching: expect misses and a few false positives. Every term shows the exact sentence so the user can check it.
- Terms with no detected definition are added with the first sentence that mentions them (or skipped if there is none); the explanation says so.
- No OCR, so scanned PDFs fail clearly. Word and text files have no page numbers.
- Phase 1 alone produces only definition-recall concepts and user-written passage concepts; phase 2 adds the other question types as quizzes.
