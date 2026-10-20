/**
 * YouTube transcripts (phase 6). Pure parsing only: URL recognition, the player response embedded in a watch page,
 * caption files (json3 and XML), playlist pages, and grouping caption cues into time windows. The network lives in
 * src/server/ingestion/youtube.ts so all of this is testable on fixtures.
 */

import { decodeEntities } from './entities.ts';
import type { RawUnit, SourceLocation } from './types.ts';

export type YoutubeTarget =
  | { kind: 'video'; videoId: string; url: string }
  | { kind: 'playlist'; listId: string; url: string };

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const VIDEO_ID = /^[\w-]{11}$/;
const LIST_ID = /^[\w-]{10,64}$/;

/** A single video (watch, short link, shorts, embed, live) or a playlist. A watch link that also carries `list=` is the video. */
export function parseYoutubeUrl(input: string): YoutubeTarget | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !HOSTS.has(url.hostname.toLowerCase())) return null;

  const video = (id: string | null | undefined): YoutubeTarget | null =>
    id && VIDEO_ID.test(id) ? { kind: 'video', videoId: id, url: `https://www.youtube.com/watch?v=${id}` } : null;

  if (url.hostname.toLowerCase() === 'youtu.be') return video(url.pathname.split('/')[1]);

  const [, first, second] = url.pathname.split('/');
  if (first === 'watch') {
    return video(url.searchParams.get('v')) ?? null;
  }
  if (['shorts', 'embed', 'live', 'v'].includes(first)) return video(second);
  if (first === 'playlist') {
    const list = url.searchParams.get('list');
    return list && LIST_ID.test(list) ? { kind: 'playlist', listId: list, url: `https://www.youtube.com/playlist?list=${list}` } : null;
  }
  return null;
}

/** Stable key for a video, so importing it twice is idempotent (hashed into sources.sha256). */
export const youtubeSourceKey = (videoId: string) => `youtube:${videoId}`;

// ---------------------------------------------------------------- player response

/** Parses the JSON object that starts at the first "{" after `marker`, respecting strings and escapes. */
export function extractJsonAfter(html: string, marker: string): unknown | null {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at + marker.length);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** "asr" = automatic speech recognition; manual tracks have no kind. */
  kind: string | null;
  name: string;
}

export interface PlayerInfo {
  /** playabilityStatus.status: OK, ERROR, UNPLAYABLE, LOGIN_REQUIRED, LIVE_STREAM_OFFLINE, ... */
  status: string;
  reason: string | null;
  title: string | null;
  lengthSeconds: number | null;
  tracks: CaptionTrack[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);

export function playerInfo(playerResponse: unknown): PlayerInfo | null {
  const pr = obj(playerResponse);
  if (!pr) return null;
  const playability = obj(pr.playabilityStatus);
  const details = obj(pr.videoDetails);
  const renderer = obj(obj(pr.captions)?.playerCaptionsTracklistRenderer);
  const rawTracks = Array.isArray(renderer?.captionTracks) ? (renderer!.captionTracks as unknown[]) : [];
  const tracks = rawTracks.flatMap((t): CaptionTrack[] => {
    const o = obj(t);
    if (!o || typeof o.baseUrl !== 'string') return [];
    const name = obj(o.name);
    return [{
      baseUrl: o.baseUrl,
      languageCode: typeof o.languageCode === 'string' ? o.languageCode : '',
      kind: typeof o.kind === 'string' ? o.kind : null,
      name: typeof name?.simpleText === 'string' ? name.simpleText : '',
    }];
  });
  const length = Number(details?.lengthSeconds);
  return {
    status: typeof playability?.status === 'string' ? playability.status : 'UNKNOWN',
    reason: typeof playability?.reason === 'string' ? playability.reason : null,
    title: typeof details?.title === 'string' ? details.title : null,
    lengthSeconds: Number.isFinite(length) ? length : null,
    tracks,
  };
}

/** Prefers a human-made track in the wanted language, then an automatic one, then any manual track, then any. */
export function pickTrack(tracks: CaptionTrack[], language = 'en'): CaptionTrack | null {
  const lang = (t: CaptionTrack) => t.languageCode.toLowerCase().split('-')[0] === language;
  return (
    tracks.find(t => lang(t) && t.kind === null) ??
    tracks.find(t => lang(t)) ??
    tracks.find(t => t.kind === null) ??
    tracks[0] ??
    null
  );
}

/** Caption URLs are fetched server-side, so only https URLs on youtube.com are allowed (no SSRF to arbitrary hosts). */
export function isAllowedCaptionUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'youtube.com' || host.endsWith('.youtube.com'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- captions

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const clean = (s: string) => decodeEntities(decodeEntities(s)).replace(/\s+/g, ' ').trim();

/** YouTube's json3 caption format: { events: [{ tStartMs, dDurationMs, segs: [{ utf8 }] }] }. */
export function parseCaptionsJson3(input: unknown): Cue[] {
  const events = Array.isArray(obj(input)?.events) ? (obj(input)!.events as unknown[]) : [];
  const cues: Cue[] = [];
  for (const e of events) {
    const o = obj(e);
    if (!o || !Array.isArray(o.segs)) continue;
    const text = clean((o.segs as unknown[]).map(s => (typeof obj(s)?.utf8 === 'string' ? (obj(s)!.utf8 as string) : '')).join(''));
    if (!text) continue;
    const start = Number(o.tStartMs) / 1000;
    const dur = Number(o.dDurationMs) / 1000;
    if (!Number.isFinite(start)) continue;
    cues.push({ start, end: start + (Number.isFinite(dur) ? dur : 0), text });
  }
  return cues;
}

/** The older XML format: <transcript><text start="1.2" dur="3.4">…</text></transcript> (also tolerates srv3's <p t= d=>). */
export function parseCaptionsXml(xml: string): Cue[] {
  const cues: Cue[] = [];
  for (const m of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const start = Number(/start="([\d.]+)"/.exec(m[1])?.[1]);
    const dur = Number(/dur="([\d.]+)"/.exec(m[1])?.[1]);
    const text = clean(m[2].replace(/<[^>]+>/g, ''));
    if (text && Number.isFinite(start)) cues.push({ start, end: start + (Number.isFinite(dur) ? dur : 0), text });
  }
  if (cues.length > 0) return cues;
  for (const m of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const start = Number(/\bt="(\d+)"/.exec(m[1])?.[1]) / 1000;
    const dur = Number(/\bd="(\d+)"/.exec(m[1])?.[1]) / 1000;
    const text = clean(m[2].replace(/<[^>]+>/g, ''));
    if (text && Number.isFinite(start)) cues.push({ start, end: start + (Number.isFinite(dur) ? dur : 0), text });
  }
  return cues;
}

/** Collapses cues into windows of `windowSec` seconds (by start time) as ingestion units with their time range. */
export function groupCuesIntoUnits(cues: Cue[], windowSec = 60): RawUnit[] {
  const buckets = new Map<number, Cue[]>();
  for (const c of [...cues].sort((a, b) => a.start - b.start)) {
    const key = Math.floor(c.start / windowSec);
    buckets.set(key, [...(buckets.get(key) ?? []), c]);
  }
  return [...buckets.entries()].map(([, list], i) => ({
    index: i + 1,
    text: list.map(c => c.text).join(' '),
    startSec: Math.floor(list[0].start),
    endSec: Math.ceil(Math.max(...list.map(c => c.end))),
  }));
}

// ---------------------------------------------------------------- playlists

/** Video ids in a playlist page, in order, without duplicates. */
export function extractPlaylistVideoIds(html: string): string[] {
  const ids: string[] = [];
  for (const m of html.matchAll(/"playlistVideoRenderer":\{"videoId":"([\w-]{11})"/g)) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}

export function extractPageTitle(html: string): string | null {
  const og = /<meta\s+property="og:title"\s+content="([^"]*)"/i.exec(html)?.[1];
  const title = og ?? /<title>([^<]*)<\/title>/i.exec(html)?.[1];
  const cleaned = title ? decodeEntities(title).replace(/\s*-\s*YouTube\s*$/i, '').trim() : '';
  return cleaned || null;
}

// ---------------------------------------------------------------- links back to the video

/** The video URL opened at the start of a section (or the plain URL when the location has no time). */
export function youtubeLinkAt(url: string, location: SourceLocation | null | undefined): string {
  const l = (location ?? {}) as { t?: number; tStart?: number };
  const seconds = l.tStart ?? l.t;
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor(seconds)}s`;
}
