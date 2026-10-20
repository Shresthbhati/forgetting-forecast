/**
 * YouTube transcript fetching (phase 6). Captions only: no audio or video is downloaded and nothing is transcribed.
 * The watch page embeds a player response that lists caption tracks; we pick one and fetch it as json3 (or XML).
 * All parsing is in the domain layer; this file owns the network, so `fetchImpl` is injectable for tests.
 * This reads an undocumented page structure, so it can break when YouTube changes it — failures surface as readable
 * ExtractionErrors rather than crashing.
 */

import {
  extractJsonAfter, extractPageTitle, extractPlaylistVideoIds, groupCuesIntoUnits, isAllowedCaptionUrl,
  parseCaptionsJson3, parseCaptionsXml, pickTrack, playerInfo, type Cue,
} from '../../domain/ingestion/youtube.ts';
import type { RawUnit } from '../../domain/ingestion/types.ts';
import { ExtractionError } from './extract.ts';

export type FetchLike = typeof fetch;

const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_CAPTION_BYTES = 3 * 1024 * 1024;
export const MAX_PLAYLIST_VIDEOS = 25;
/** Videos longer than this are refused: their transcripts would exceed the section cap. */
const MAX_VIDEO_SECONDS = 6 * 60 * 60;

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
  // Skips the EU consent interstitial, which otherwise replaces the watch page.
  cookie: 'CONSENT=YES+1; SOCS=CAI',
};

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, maxBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ExtractionError('YouTube returned a response that was too large to process');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function getText(url: string, fetchImpl: FetchLike, maxBytes: number): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new ExtractionError('Could not reach YouTube. Try again in a moment');
  }
  if (!response.ok) throw new ExtractionError(`YouTube returned an error (${response.status}). Try again later`);
  return readCapped(response, maxBytes);
}

export interface FetchedTranscript {
  title: string;
  durationSec: number | null;
  language: string;
  /** True when the only captions are YouTube's automatic ones (no punctuation, more mistakes). */
  automatic: boolean;
  units: RawUnit[];
}

const UNPLAYABLE: Record<string, string> = {
  LOGIN_REQUIRED: 'This video requires signing in (private, members-only or age-restricted)',
  UNPLAYABLE: 'This video is unavailable or restricted',
  ERROR: 'This video does not exist or was removed',
  LIVE_STREAM_OFFLINE: 'This is a live stream that has no recording yet',
};

export async function fetchTranscript(videoId: string, fetchImpl: FetchLike = fetch): Promise<FetchedTranscript> {
  const html = await getText(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, fetchImpl, MAX_PAGE_BYTES);
  const info = playerInfo(extractJsonAfter(html, 'ytInitialPlayerResponse'));
  if (!info) throw new ExtractionError('Could not read this video page. YouTube may have changed its format');
  if (info.status !== 'OK') {
    throw new ExtractionError(UNPLAYABLE[info.status] ?? info.reason ?? 'This video cannot be read');
  }
  if (info.lengthSeconds && info.lengthSeconds > MAX_VIDEO_SECONDS) throw new ExtractionError('This video is longer than 6 hours');

  const track = pickTrack(info.tracks);
  if (!track) throw new ExtractionError('No transcript available for this video');
  if (!isAllowedCaptionUrl(track.baseUrl)) throw new ExtractionError('Could not read the captions for this video');

  const captionUrl = new URL(track.baseUrl);
  captionUrl.searchParams.set('fmt', 'json3');
  const body = await getText(captionUrl.toString(), fetchImpl, MAX_CAPTION_BYTES);
  let cues: Cue[] = [];
  try {
    cues = parseCaptionsJson3(JSON.parse(body));
  } catch {
    cues = parseCaptionsXml(body);
  }
  if (cues.length === 0) throw new ExtractionError('No transcript available for this video');

  return {
    title: (info.title ?? extractPageTitle(html) ?? 'YouTube video').slice(0, 300),
    durationSec: info.lengthSeconds,
    language: track.languageCode || 'unknown',
    automatic: track.kind === 'asr',
    units: groupCuesIntoUnits(cues),
  };
}

export interface FetchedPlaylist {
  title: string;
  videoIds: string[];
  /** True when the playlist had more videos than we import in one go. */
  truncated: boolean;
}

export async function fetchPlaylist(listId: string, fetchImpl: FetchLike = fetch): Promise<FetchedPlaylist> {
  const html = await getText(`https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}&hl=en`, fetchImpl, MAX_PAGE_BYTES);
  const ids = extractPlaylistVideoIds(html);
  if (ids.length === 0) throw new ExtractionError('Could not find any videos in this playlist (it may be private or empty)');
  return {
    title: (extractPageTitle(html) ?? 'YouTube playlist').slice(0, 300),
    videoIds: ids.slice(0, MAX_PLAYLIST_VIDEOS),
    truncated: ids.length > MAX_PLAYLIST_VIDEOS,
  };
}
