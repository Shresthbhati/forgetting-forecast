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
| 2 | Assessment engine (our own) | not started |
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

### 2. Assessment engine (our own)

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

## Known limits of phase 1

- Definition detection is pattern matching: expect misses and a few false positives. Every term shows the exact sentence so the user can check it.
- Terms with no detected definition are added with the first sentence that mentions them (or skipped if there is none); the explanation says so.
- No OCR, so scanned PDFs fail clearly. Word and text files have no page numbers.
- No cloze / multiple-choice / true-false yet: phase 1 produces definition-recall concepts and user-written passage concepts only.
