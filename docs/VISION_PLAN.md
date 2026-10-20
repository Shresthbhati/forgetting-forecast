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
| 3 | Memory engine upgrades | not started |
| 4 | Mixed tests across subjects | not started |
| 5 | Knowledge graph and exam mode | not started |
| 6 | YouTube (captions only) | not started |

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

### 6. YouTube (later)

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

## Known limits of phase 1

- Definition detection is pattern matching: expect misses and a few false positives. Every term shows the exact sentence so the user can check it.
- Terms with no detected definition are added with the first sentence that mentions them (or skipped if there is none); the explanation says so.
- No OCR, so scanned PDFs fail clearly. Word and text files have no page numbers.
- Phase 1 alone produces only definition-recall concepts and user-written passage concepts; phase 2 adds the other question types as quizzes.
