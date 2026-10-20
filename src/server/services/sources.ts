/**
 * Application service for uploaded study material.
 * Pipeline: hash -> store -> extract -> split into sections -> extract terms -> one atomic RPC (ingest_source_tx).
 * Any failure after the row exists marks the source `failed` with a readable message; nothing is half-written.
 */

import { createHash, randomUUID } from 'node:crypto';
import { detectKind, fileExtension } from '@/domain/ingestion/kind';
import { formatSourceReference } from '@/domain/ingestion/location';
import { normalizeUnits } from '@/domain/ingestion/normalize';
import { segmentUnits } from '@/domain/ingestion/segment';
import { candidatePhrases, contextSentence, extractTerms } from '@/domain/ingestion/terms';
import { MAX_UPLOAD_BYTES, type SourceKind } from '@/domain/ingestion/types';
import { ExtractionError, extractUnits } from '@/server/ingestion/extract';
import { fetchPlaylist, fetchTranscript, MAX_PLAYLIST_VIDEOS, type FetchLike } from '@/server/ingestion/youtube';
import { parseYoutubeUrl, youtubeSourceKey } from '@/domain/ingestion/youtube';
import { NotFoundError, ValidationError } from '@/server/errors';
import * as repo from '@/server/repositories/sources';
import { createConceptWithState } from '@/server/services/concepts';
import { generateQuestions } from '@/domain/assessment/generators';
import { computeTopicMastery } from '@/domain/assessment/mastery';
import type { CreateConceptsFromSourceInput } from '@/server/validation/schemas';
import type {
  CreatedFromSource, QuizResponse, Source, SourceDetail, SourceGroup, SourceMastery, UploadSourceResult, UUID, YoutubeImportItem,
  YoutubeImportResult,
} from '@/types';

const CONTENT_TYPES: Record<SourceKind, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  text: 'text/plain',
  // YouTube sources have no stored file; this entry only satisfies the exhaustive record.
  youtube: 'text/plain',
};

export interface UploadInput {
  filename: string;
  bytes: Uint8Array;
  subject: string;
  title?: string;
}

const termPrompt = (term: string) => `Define: ${term}`;

export async function listUserSources(): Promise<Source[]> {
  return repo.listSources();
}

export async function getSourceDetail(id: UUID): Promise<SourceDetail> {
  const source = await repo.getSource(id);
  if (!source) throw new NotFoundError('Source');
  const [sections, terms, prompts] = await Promise.all([repo.listSections(id), repo.listTerms(id), repo.listConceptPromptsForSource(id)]);
  const addedTermIds = terms.filter(t => prompts.has(termPrompt(t.term).toLowerCase())).map(t => t.id);
  return { source, sections, terms, addedTermIds };
}

/** Document frequency of each phrase across the subject's other sources, so common words score lower. */
async function subjectStats(subject: string, sourceId: UUID) {
  const texts = await repo.listSubjectSectionTexts(subject, sourceId);
  const externalDocFreq = new Map<string, number>();
  for (const text of texts) {
    for (const key of candidatePhrases(text).keys()) externalDocFreq.set(key, (externalDocFreq.get(key) ?? 0) + 1);
  }
  return { externalSections: texts.length, externalDocFreq };
}

export async function uploadSource(input: UploadInput): Promise<UploadSourceResult> {
  if (input.bytes.byteLength === 0) throw new ValidationError('The file is empty');
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new ValidationError('The file is larger than the 20 MB limit');
  const kind = detectKind(input.filename, input.bytes.subarray(0, 16));
  if (!kind) {
    throw new ValidationError('Unsupported or mismatched file. Upload a PDF, PPTX, DOCX, TXT or MD file.');
  }

  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const existing = await repo.findSourceByHash(sha256);
  if (existing && existing.status !== 'failed') return { source: existing, duplicate: true };
  if (existing) {
    // A failed upload can be retried: clear the old attempt so the unique (user, sha256) slot is free.
    await repo.deleteSource(existing.id);
    await repo.removeObject(existing.storagePath).catch(() => undefined);
  }

  const userId = await repo.getCurrentUserId();
  const id = randomUUID() as UUID;
  const ext = fileExtension(input.filename);
  const storagePath = `${userId}/${id}.${ext}`;
  const title = (input.title ?? input.filename.replace(/\.[^.]+$/, '')).trim().slice(0, 300) || 'Untitled';

  const inserted = await repo.insertSource({
    id, subject: input.subject, title, kind, storagePath, byteSize: input.bytes.byteLength, sha256,
  });
  if (!inserted) {
    // Lost a race with a concurrent upload of the same file: return that one.
    const winner = await repo.findSourceByHash(sha256);
    if (winner) return { source: winner, duplicate: true };
    throw new Error('Failed to create source');
  }

  try {
    await repo.uploadObject(storagePath, input.bytes, CONTENT_TYPES[kind]);

    const raw = await extractUnits(kind, input.bytes);
    const units = normalizeUnits(raw, { stripRepeated: kind === 'pdf' });
    const sections = segmentUnits(units, kind, title);
    if (sections.length === 0) throw new ExtractionError('No readable text found in this file');

    const stats = await subjectStats(input.subject, id);
    const terms = extractTerms(sections, stats);

    await repo.ingestSource(id, {
      unitCount: raw.length,
      sections: sections.map(s => ({ ordinal: s.ordinal, level: s.level, heading: s.heading, text: s.text, location: s.location })),
      terms: terms.map(t => ({
        term: t.term, definition: t.definition, section_ordinal: t.sectionOrdinal, location: t.location, score: t.score,
      })),
    });
    const ready = await repo.getSource(id);
    return { source: ready ?? inserted, duplicate: false };
  } catch (error) {
    const message = error instanceof ExtractionError ? error.message : 'Processing failed unexpectedly. Try uploading again.';
    if (!(error instanceof ExtractionError)) {
      // Structured line only: file contents and filenames must not reach logs.
      console.error(JSON.stringify({ level: 'error', code: 'SOURCE_INGEST_FAILED', sourceId: id, errorName: error instanceof Error ? error.name : 'unknown' }));
    }
    return { source: await repo.markSourceFailed(id, message), duplicate: false };
  }
}

export async function listUserSourceGroups(): Promise<SourceGroup[]> {
  return repo.listSourceGroups();
}

/** Imports one video: fetch captions, segment by time, extract terms, then the same atomic ingest as an upload. */
async function importVideo(videoId: string, subject: string, groupId: UUID | null, fetchImpl: FetchLike): Promise<YoutubeImportItem> {
  const sha256 = createHash('sha256').update(youtubeSourceKey(videoId)).digest('hex');
  const existing = await repo.findSourceByHash(sha256);
  if (existing && existing.status !== 'failed') return { videoId, status: 'duplicate', source: existing, error: null };
  if (existing) await repo.deleteSource(existing.id);

  const id = randomUUID() as UUID;
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  // The row is created first so a failure is visible in the library with its reason (same as uploads).
  const inserted = await repo.insertSource({
    id, subject, title: `YouTube video ${videoId}`, kind: 'youtube', storagePath: youtubeSourceKey(videoId), byteSize: 0, sha256,
    sourceUrl: url, groupId,
  });
  if (!inserted) {
    const winner = await repo.findSourceByHash(sha256);
    return { videoId, status: 'duplicate', source: winner, error: null };
  }

  try {
    const transcript = await fetchTranscript(videoId, fetchImpl);
    const units = normalizeUnits(transcript.units, { stripRepeated: false });
    const sections = segmentUnits(units, 'youtube', transcript.title);
    if (sections.length === 0) throw new ExtractionError('No transcript available for this video');
    const stats = await subjectStats(subject, id);
    const terms = extractTerms(sections, stats);
    await repo.renameSource(id, transcript.title);
    await repo.ingestSource(id, {
      unitCount: units.length,
      sections: sections.map(x => ({ ordinal: x.ordinal, level: x.level, heading: x.heading, text: x.text, location: x.location })),
      terms: terms.map(t => ({ term: t.term, definition: t.definition, section_ordinal: t.sectionOrdinal, location: t.location, score: t.score })),
    });
    return { videoId, status: 'imported', source: (await repo.getSource(id)) ?? inserted, error: null };
  } catch (error) {
    const message = error instanceof ExtractionError ? error.message : 'Processing failed unexpectedly. Try again';
    if (!(error instanceof ExtractionError)) {
      console.error(JSON.stringify({ level: 'error', code: 'YOUTUBE_INGEST_FAILED', sourceId: id, errorName: error instanceof Error ? error.name : 'unknown' }));
    }
    return { videoId, status: 'failed', source: await repo.markSourceFailed(id, message), error: message };
  }
}

/**
 * A video link becomes one source; a playlist link becomes a group with one source per video (first
 * MAX_PLAYLIST_VIDEOS). Captions only, so videos without a transcript fail individually with a readable message.
 */
export async function importYoutube(input: { url: string; subject: string }, fetchImpl: FetchLike = fetch): Promise<YoutubeImportResult> {
  const target = parseYoutubeUrl(input.url);
  if (!target) throw new ValidationError('That is not a YouTube video or playlist link');

  if (target.kind === 'video') {
    return { group: null, items: [await importVideo(target.videoId, input.subject, null, fetchImpl)], truncated: false };
  }

  let playlist;
  try {
    playlist = await fetchPlaylist(target.listId, fetchImpl);
  } catch (error) {
    if (error instanceof ExtractionError) throw new ValidationError(error.message);
    throw error;
  }
  const group = await repo.insertSourceGroup(playlist.title, target.url);
  const items: YoutubeImportItem[] = [];
  for (const videoId of playlist.videoIds.slice(0, MAX_PLAYLIST_VIDEOS)) {
    items.push(await importVideo(videoId, input.subject, group.id, fetchImpl));
  }
  return { group, items, truncated: playlist.truncated };
}

export async function deleteUserSource(id: UUID): Promise<void> {
  const source = await repo.getSource(id);
  if (!source) throw new NotFoundError('Source');
  if (source.kind !== 'youtube') await repo.removeObject(source.storagePath).catch(() => undefined);
  await repo.deleteSource(id);
}

const NO_DEFINITION = "No definition or usable sentence found in the text — use 'Make a concept' on its section instead";

/**
 * Creates concepts from detected terms (definition recall: "Define: term" -> the defining sentence) or from a
 * passage the user phrased. Each concept keeps its source, section and page/slide. Items that can't be made are
 * reported in `skipped` rather than failing the whole request.
 */
export async function createConceptsFromSource(sourceId: UUID, input: CreateConceptsFromSourceInput): Promise<CreatedFromSource> {
  const source = await repo.getSource(sourceId);
  if (!source) throw new NotFoundError('Source');
  if (source.status !== 'ready') throw new ValidationError('This source has not finished processing');

  const termIds = input.items.flatMap(i => (i.type === 'term' ? [i.termId as UUID] : []));
  const passageSectionIds = input.items.flatMap(i => (i.type === 'passage' ? [i.sectionId as UUID] : []));
  const terms = new Map((await repo.getTermsByIds(sourceId, termIds)).map(t => [t.id, t]));
  const sectionIds = [...new Set([...passageSectionIds, ...[...terms.values()].flatMap(t => (t.sectionId ? [t.sectionId] : []))])];
  const sections = new Map((await repo.getSectionsByIds(sourceId, sectionIds)).map(s => [s.id, s]));
  const existing = await repo.listConceptPromptsForSource(sourceId);

  const result: CreatedFromSource = { created: [], skipped: [] };
  for (const item of input.items) {
    const termId = item.type === 'term' ? (item.termId as UUID) : undefined;
    const sectionId = item.type === 'passage' ? (item.sectionId as UUID) : undefined;
    const skip = (reason: string) => result.skipped.push({ termId, sectionId, reason });

    let prompt: string;
    let answer: string;
    let note: string;
    let generated: boolean;
    let section;
    let location;
    if (item.type === 'term') {
      const term = terms.get(item.termId);
      if (!term) { skip('Term not found in this source'); continue; }
      section = term.sectionId ? sections.get(term.sectionId) : undefined;
      location = term.location;
      const sentence = term.definition ?? (section ? contextSentence(section.text, term.term) : null);
      if (!sentence) { skip(NO_DEFINITION); continue; }
      prompt = termPrompt(term.term);
      answer = sentence;
      note = term.definition ? 'Definition sentence taken from' : 'Sentence mentioning the term (no explicit definition found) taken from';
      generated = true;
    } else {
      section = sections.get(item.sectionId);
      if (!section) { skip('Section not found in this source'); continue; }
      location = section.location;
      prompt = item.prompt;
      answer = item.answer;
      note = 'Written from a passage in';
      generated = false;
    }

    if (existing.has(prompt.trim().toLowerCase())) { skip('Already added'); continue; }
    const reference = formatSourceReference(source.title, location);
    try {
      const concept = await createConceptWithState({
        subject: source.subject,
        topic: section ? section.heading.slice(0, 100) : null,
        prompt,
        answer,
        explanation: `${note} ${reference}.${generated ? ' Generated by rules, not reviewed by a model.' : ''}`,
        difficulty: input.difficulty,
        tags: ['from-source'],
        sourceReference: reference,
        sourceId,
        sourceSectionId: section?.id ?? null,
        sourceLocation: location,
      });
      existing.add(prompt.trim().toLowerCase());
      result.created.push(concept);
    } catch {
      skip('Could not save this concept');
    }
  }
  return result;
}

const MAX_QUIZ_QUESTIONS = 10;

/**
 * A quiz for one section, generated by rules from its text. It covers the section's terms that already have a
 * concept (so every answer can be recorded as a real attempt) plus any formulas found in the text (practice only).
 */
export async function buildSectionQuiz(sourceId: UUID, sectionId: UUID, seed?: number): Promise<QuizResponse> {
  const source = await repo.getSource(sourceId);
  if (!source) throw new NotFoundError('Source');
  if (source.status !== 'ready') throw new ValidationError('This source has not finished processing');
  const [section] = await repo.getSectionsByIds(sourceId, [sectionId]);
  if (!section) throw new NotFoundError('Section');

  const [allTerms, concepts, subjectTerms] = await Promise.all([
    repo.listTerms(sourceId),
    repo.listSourceConcepts(sourceId),
    repo.listSubjectDefinedTerms(source.subject),
  ]);
  const conceptByPrompt = new Map(concepts.map(c => [c.prompt.trim().toLowerCase(), c.id]));
  const inSection = allTerms.filter(t => t.sectionId === sectionId && t.definition);
  const withConcept = inSection.flatMap(t => {
    const conceptId = conceptByPrompt.get(termPrompt(t.term).toLowerCase());
    return conceptId ? [{ termId: t.id, conceptId, term: t.term, definition: t.definition, sectionId, location: t.location }] : [];
  });

  const quizSeed = seed ?? Math.floor(Math.random() * 2_147_483_647);
  const questions = generateQuestions({
    terms: withConcept,
    pool: subjectTerms,
    formulas: [{ text: section.text, sectionId, location: section.location }],
    seed: quizSeed,
  }).slice(0, MAX_QUIZ_QUESTIONS);

  return {
    section: { id: section.id, heading: section.heading, location: section.location },
    questions,
    seed: quizSeed,
    termsInSection: inSection.length,
    termsWithoutConcept: inSection.length - withConcept.length,
    unaddedTermIds: inSection.filter(t => !withConcept.some(w => w.termId === t.id)).map(t => t.id),
  };
}

/** Per-topic mastery for the concepts made from this source, computed from their real attempts. */
export async function getSourceMastery(sourceId: UUID): Promise<SourceMastery> {
  const source = await repo.getSource(sourceId);
  if (!source) throw new NotFoundError('Source');
  const concepts = await repo.listSourceConcepts(sourceId);
  const attempts = await repo.listAttemptsForConcepts(concepts.map(c => c.id));
  return { topics: computeTopicMastery(concepts.map(c => ({ id: c.id, topic: c.topic })), attempts, new Date()) };
}
