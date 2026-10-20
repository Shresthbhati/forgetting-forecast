import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPlaylist, fetchTranscript, MAX_PLAYLIST_VIDEOS, type FetchLike } from '../src/server/ingestion/youtube.ts';

const CAPTION_URL = 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en';

function watchPage(player: unknown) {
  return `<html><title>x - YouTube</title><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = 1;</script></html>`;
}

const player = (over: Record<string, unknown> = {}) => ({
  playabilityStatus: { status: 'OK' },
  videoDetails: { title: 'Normalization lecture', lengthSeconds: '600' },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: CAPTION_URL, languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto-generated)' } }] } },
  ...over,
});

const json3 = {
  events: [
    { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: 'A candidate key is a minimal set of attributes' }] },
    { tStartMs: 4000, dDurationMs: 4000, segs: [{ utf8: 'that uniquely identifies a row.' }] },
  ],
};

function mockFetch(routes: Array<[RegExp, () => Response]>, seen: string[] = []): FetchLike {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const hit = routes.find(([re]) => re.test(url));
    return hit ? hit[1]() : new Response('not found', { status: 404 });
  }) as FetchLike;
}

test('fetchTranscript: watch page -> player response -> json3 captions -> time-window units', async () => {
  const seen: string[] = [];
  const result = await fetchTranscript('abcdefghijk', mockFetch([
    [/watch\?v=abcdefghijk/, () => new Response(watchPage(player()))],
    [/timedtext/, () => new Response(JSON.stringify(json3))],
  ], seen));
  assert.equal(result.title, 'Normalization lecture');
  assert.equal(result.automatic, true);
  assert.equal(result.durationSec, 600);
  assert.equal(result.units.length, 1);
  assert.match(result.units[0].text, /candidate key.*uniquely identifies/);
  assert.ok(seen.some(u => u.includes('fmt=json3')), 'asks for json3');
});

test('fetchTranscript: falls back to XML captions', async () => {
  const xml = '<transcript><text start="0" dur="3">Hello &amp;amp; welcome</text></transcript>';
  const result = await fetchTranscript('abcdefghijk', mockFetch([
    [/watch\?v=/, () => new Response(watchPage(player()))],
    [/timedtext/, () => new Response(xml)],
  ]));
  assert.equal(result.units[0].text, 'Hello & welcome');
});

test('fetchTranscript: readable errors for the failure modes', async () => {
  const run = (resp: () => Response, caption?: () => Response) =>
    fetchTranscript('abcdefghijk', mockFetch([[/watch\?v=/, resp], [/timedtext/, caption ?? (() => new Response('{}'))]]));

  await assert.rejects(run(() => new Response(watchPage(player({ captions: undefined })))), /No transcript available for this video/);
  await assert.rejects(run(() => new Response(watchPage(player({ playabilityStatus: { status: 'LOGIN_REQUIRED' } })))), /requires signing in/);
  await assert.rejects(run(() => new Response(watchPage(player({ playabilityStatus: { status: 'ERROR' } })))), /does not exist or was removed/);
  await assert.rejects(run(() => new Response('<html>no player here</html>')), /Could not read this video page/);
  await assert.rejects(run(() => new Response('', { status: 429 })), /YouTube returned an error \(429\)/);
  await assert.rejects(run(() => new Response(watchPage(player())), () => new Response(JSON.stringify({ events: [] }))), /No transcript available/);
  await assert.rejects(run(() => new Response(watchPage(player({ videoDetails: { title: 't', lengthSeconds: '99999' } })))), /longer than 6 hours/);
});

test('fetchTranscript: never fetches a caption URL outside youtube.com (SSRF guard)', async () => {
  const seen: string[] = [];
  const evil = player({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://169.254.169.254/latest/meta-data', languageCode: 'en' }] } } });
  await assert.rejects(
    fetchTranscript('abcdefghijk', mockFetch([[/watch\?v=/, () => new Response(watchPage(evil))]], seen)),
    /Could not read the captions/,
  );
  assert.equal(seen.length, 1, 'only the watch page was requested');
});

test('fetchTranscript: a network failure is a readable error, not a crash', async () => {
  const failing = (async () => { throw new TypeError('fetch failed'); }) as unknown as FetchLike;
  await assert.rejects(fetchTranscript('abcdefghijk', failing), /Could not reach YouTube/);
});

test('fetchTranscript: oversized responses are cut off', async () => {
  const big = 'x'.repeat(5 * 1024 * 1024);
  await assert.rejects(fetchTranscript('abcdefghijk', mockFetch([[/watch\?v=/, () => new Response(big)]])), /too large/);
});

test('fetchPlaylist: ids in order, capped, with a truncated flag', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `vid${String(i).padStart(8, '0')}`);
  const html = `<meta property="og:title" content="DBMS &amp; SQL - YouTube">` + ids.map(id => `"playlistVideoRenderer":{"videoId":"${id}"`).join(',');
  const result = await fetchPlaylist('PLabcdefghij', mockFetch([[/playlist\?list=/, () => new Response(html)]]));
  assert.equal(result.title, 'DBMS & SQL');
  assert.equal(result.videoIds.length, MAX_PLAYLIST_VIDEOS);
  assert.equal(result.videoIds[0], ids[0]);
  assert.equal(result.truncated, true);
  await assert.rejects(fetchPlaylist('PLabcdefghij', mockFetch([[/playlist/, () => new Response('<html></html>')]])), /Could not find any videos/);
});
