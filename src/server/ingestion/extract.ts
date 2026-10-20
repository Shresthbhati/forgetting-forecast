/**
 * Text extraction for uploaded study material (Node runtime only).
 *  - PDF: unpdf, one unit per page
 *  - DOCX: mammoth (HTML, so headings survive as "#" lines)
 *  - PPTX: jszip + the <a:t> runs of each slide, title from the title placeholder, in presentation order
 *  - TXT/MD: UTF-8
 * Imports are relative (no "@/") so tests can run this file directly under node.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { decodeEntities } from '../../domain/ingestion/entities.ts';
import { MAX_UNITS, type RawUnit, type SourceKind } from '../../domain/ingestion/types.ts';

export const MAX_TOTAL_CHARS = 3_000_000;
const MAX_ZIP_ENTRIES = 3000;
const MAX_ZIP_UNCOMPRESSED = 200 * 1024 * 1024;
/** Fewer than this many letters/digits across the whole file means there is no text layer to read. */
const MIN_TEXT_CHARS = 40;

/** A failure with a message safe to show the user (stored in sources.error). */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export async function extractUnits(kind: SourceKind, bytes: Uint8Array): Promise<RawUnit[]> {
  const units = await extractByKind(kind, bytes);
  const total = units.reduce((n, u) => n + u.text.length + (u.title?.length ?? 0), 0);
  if (total > MAX_TOTAL_CHARS) throw new ExtractionError('The document has too much text to process (over 3 million characters)');
  const letters = units.reduce((n, u) => n + ((u.title ?? '') + u.text).replace(/[^\p{L}\p{N}]/gu, '').length, 0);
  if (letters < MIN_TEXT_CHARS) {
    throw new ExtractionError(
      kind === 'pdf' ? 'No text layer — OCR not supported yet' : 'No readable text found in this file'
    );
  }
  return units;
}

async function extractByKind(kind: SourceKind, bytes: Uint8Array): Promise<RawUnit[]> {
  switch (kind) {
    case 'pdf': return extractPdf(bytes);
    case 'docx': return extractDocx(bytes);
    case 'pptx': return extractPptx(bytes);
    case 'text': return extractPlainText(bytes);
    case 'youtube': throw new ExtractionError('YouTube sources are imported from a link, not a file');
  }
}

async function extractPdf(bytes: Uint8Array): Promise<RawUnit[]> {
  let pages: string[];
  try {
    // pdf.js takes ownership of the buffer, so hand it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > MAX_UNITS) throw new ExtractionError(`This PDF has ${pdf.numPages} pages; the limit is ${MAX_UNITS}`);
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') throw new ExtractionError('This PDF is password protected');
    throw new ExtractionError('Could not read this PDF (it may be corrupted)');
  }
  return pages.map((text, i) => ({ index: i + 1, text }));
}

async function openZip(bytes: Uint8Array, label: string): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ExtractionError(`Could not read this ${label} file (it may be corrupted)`);
  }
  const entries = Object.values(zip.files);
  // _data.uncompressedSize is JSZip's own bookkeeping; it lets us refuse zip bombs before inflating anything.
  const uncompressed = entries.reduce((n, e) => n + ((e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (entries.length > MAX_ZIP_ENTRIES || uncompressed > MAX_ZIP_UNCOMPRESSED) {
    throw new ExtractionError(`This ${label} file is too large to process`);
  }
  return zip;
}

async function extractDocx(bytes: Uint8Array): Promise<RawUnit[]> {
  await openZip(bytes, 'DOCX');
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;
  } catch {
    throw new ExtractionError('Could not read this DOCX file (it may be corrupted)');
  }
  const text = decodeEntities(
    html
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n${'#'.repeat(Number(level))} ${inner.replace(/<[^>]+>/g, '')}\n`)
      .replace(/<\/(?:p|li|tr|div|table|ul|ol)>|<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  );
  return [{ index: 1, text }];
}

function attr(tag: string, name: string): string | null {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

/** Slide file names in presentation order (presentation.xml order, via its relationships); numeric order as a fallback. */
async function orderedSlidePaths(zip: JSZip): Promise<string[]> {
  const all = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const numeric = [...all].sort((a, b) => Number(/slide(\d+)/.exec(a)![1]) - Number(/slide(\d+)/.exec(b)![1]));
  try {
    const presentation = await zip.file('ppt/presentation.xml')?.async('string');
    const rels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
    if (!presentation || !rels) return numeric;
    const targets = new Map<string, string>();
    for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
      const id = attr(tag, 'Id');
      const target = attr(tag, 'Target');
      if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `ppt/${target}`);
    }
    const ordered = (presentation.match(/<p:sldId\b[^>]*>/g) ?? [])
      .map(tag => targets.get(attr(tag, 'r:id') ?? ''))
      .filter((p): p is string => !!p && all.includes(p));
    return ordered.length === all.length ? ordered : numeric;
  } catch {
    return numeric;
  }
}

function paragraphsOf(xml: string): string[] {
  return (xml.match(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g) ?? [])
    .map(p =>
      decodeEntities(
        p.replace(/<a:br\s*\/?>/g, ' ').match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>|<a:t\s*\/>/g)?.map(t => t.replace(/<[^>]+>/g, '')).join('') ?? ''
      ).trim()
    )
    .filter(Boolean);
}

async function extractPptx(bytes: Uint8Array): Promise<RawUnit[]> {
  const zip = await openZip(bytes, 'PPTX');
  const paths = await orderedSlidePaths(zip);
  if (paths.length === 0) throw new ExtractionError('No slides found in this PPTX file');
  if (paths.length > MAX_UNITS) throw new ExtractionError(`This deck has ${paths.length} slides; the limit is ${MAX_UNITS}`);

  const units: RawUnit[] = [];
  for (const [i, path] of paths.entries()) {
    const xml = await zip.file(path)!.async('string');
    const titleBlocks = (xml.match(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g) ?? []).filter(b => /<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(b));
    const title = titleBlocks.flatMap(paragraphsOf).join(' ').trim() || null;
    const rest = titleBlocks.reduce((acc, block) => acc.replace(block, ''), xml);
    units.push({ index: i + 1, title, text: paragraphsOf(rest).join('\n') });
  }
  return units;
}

function extractPlainText(bytes: Uint8Array): RawUnit[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ExtractionError('This file is not valid UTF-8 text');
  }
  return [{ index: 1, text: text.replace(/^﻿/, '') }];
}
