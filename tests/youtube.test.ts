import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonAfter, extractPageTitle, extractPlaylistVideoIds, groupCuesIntoUnits, isAllowedCaptionUrl,
  parseCaptionsJson3, parseCaptionsXml, parseYoutubeUrl, pickTrack, playerInfo, youtubeSourceKey, youtubeLinkAt,
} from '../src/domain/ingestion/youtube.ts';
import { formatLocation, formatTimestamp } from '../src/domain/ingestion/location.ts';
import { segmentTranscript, segmentUnits } from '../src/domain/ingestion/segment.ts';
import { normalizeUnits } from '../src/domain/ingestion/normalize.ts';
import { extractTerms } from '../src/domain/ingestion/terms.ts';

test('parseYoutubeUrl: videos in every common shape', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `  https://www.youtube.com/watch?v=${id}&list=PLabcdefghij1234  `,
  ]) {
    assert.deepEqual(parseYoutubeUrl(url), { kind: 'video', videoId: id, url: `https://www.youtube.com/watch?v=${id}` }, url);
  }
});

test('parseYoutubeUrl: playlists, and everything else is rejected', () => {
  assert.deepEqual(parseYoutubeUrl('https://www.youtube.com/playlist?list=PLabcdefghij1234'), { kind: 'playlist', listId: 'PLabcdefghij1234', url: 'https://www.youtube.com/playlist?list=PLabcdefghij1234' });
  for (const bad of ['', 'not a url', 'https://vimeo.com/123456', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/watch', 'https://www.youtube.com/channel/UC1234', 'https://www.youtube.com/playlist?list=x', 'javascript:alert(1)', 'ftp://youtu.be/dQw4w9WgXcQ']) {
    assert.equal(parseYoutubeUrl(bad), null, bad);
  }
  assert.equal(youtubeSourceKey('dQw4w9WgXcQ'), 'youtube:dQw4w9WgXcQ');
});

const PLAYER = {
  playabilityStatus: { status: 'OK' },
  videoDetails: { title: 'Normalization in 10 minutes', lengthSeconds: '610' },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=hi', languageCode: 'hi', name: { simpleText: 'Hindi' } },
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en&kind=asr', languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto-generated)' } },
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en', name: { simpleText: 'English' } },
  ] } },
};
const WATCH_HTML = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(PLAYER)};var meta = {"a":"}"};</script><body>{"decoy":1}</body></html>`;

test('extractJsonAfter reads the embedded player response even with braces inside strings', () => {
  const parsed = extractJsonAfter(WATCH_HTML, 'ytInitialPlayerResponse =') as typeof PLAYER;
  assert.equal(parsed.videoDetails.title, 'Normalization in 10 minutes');
  assert.equal(extractJsonAfter('nothing here', 'ytInitialPlayerResponse ='), null);
  assert.equal(extractJsonAfter('ytInitialPlayerResponse = {"broken": ', 'ytInitialPlayerResponse ='), null);
  const tricky = extractJsonAfter('x = {"s":"a \\"} b","n":{"k":1}};', 'x =') as { s: string; n: { k: number } };
  assert.deepEqual([tricky.s, tricky.n.k], ['a "} b', 1]);
});

test('playerInfo and pickTrack: title, status, tracks, and the preferred caption track', () => {
  const info = playerInfo(PLAYER)!;
  assert.deepEqual([info.status, info.title, info.lengthSeconds, info.tracks.length], ['OK', 'Normalization in 10 minutes', 610, 3]);
  assert.equal(pickTrack(info.tracks)!.kind, null, 'a manual English track beats the automatic one');
  assert.equal(pickTrack(info.tracks.filter(t => t.kind !== null || t.languageCode !== 'en'))!.kind, 'asr', 'automatic English beats manual Hindi');
  assert.equal(pickTrack([])!, null);
  assert.equal(playerInfo({ playabilityStatus: { status: 'ERROR', reason: 'Video unavailable' } })!.reason, 'Video unavailable');
  assert.equal(playerInfo({ playabilityStatus: { status: 'OK' } })!.tracks.length, 0, 'no captions at all');
  assert.equal(playerInfo('nope'), null);
});

test('only https youtube.com caption URLs may be fetched (no SSRF)', () => {
  assert.equal(isAllowedCaptionUrl('https://www.youtube.com/api/timedtext?v=x'), true);
  assert.equal(isAllowedCaptionUrl('https://youtube.com/api/timedtext'), true);
  for (const bad of ['http://www.youtube.com/api/timedtext', 'https://evil.com/api/timedtext', 'https://www.youtube.com.evil.com/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'file:///etc/passwd', 'x']) {
    assert.equal(isAllowedCaptionUrl(bad), false, bad);
  }
});

test('parseCaptionsJson3: text, timing, entities; empty and marker events are skipped', () => {
  const cues = parseCaptionsJson3({ events: [
    { tStartMs: 0, dDurationMs: 2000 },
    { tStartMs: 1200, dDurationMs: 3400, segs: [{ utf8: 'Normalization is ' }, { utf8: 'the process\nof organizing' }] },
    { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
    { tStartMs: 6000, dDurationMs: 2000, segs: [{ utf8: 'it&#39;s &amp;amp; more' }] },
  ] });
  assert.deepEqual(cues, [
    { start: 1.2, end: 4.6, text: 'Normalization is the process of organizing' },
    { start: 6, end: 8, text: "it's & more" },
  ]);
  assert.deepEqual(parseCaptionsJson3({}), []);
  assert.deepEqual(parseCaptionsJson3(null), []);
});

test('parseCaptionsXml: both the classic <text> and the srv3 <p> formats', () => {
  const classic = '<?xml version="1.0"?><transcript><text start="0.5" dur="2.5">Hello &amp;amp; welcome</text><text start="3" dur="2">to the&#39;lecture</text></transcript>';
  assert.deepEqual(parseCaptionsXml(classic), [{ start: 0.5, end: 3, text: 'Hello & welcome' }, { start: 3, end: 5, text: "to the'lecture" }]);
  const srv3 = '<timedtext><body><p t="1000" d="2000"><s>A</s><s> keyword</s></p></body></timedtext>';
  assert.deepEqual(parseCaptionsXml(srv3), [{ start: 1, end: 3, text: 'A keyword' }]);
  assert.deepEqual(parseCaptionsXml('<transcript></transcript>'), []);
});

test('groupCuesIntoUnits windows cues by start time and records the seconds covered', () => {
  const cues = [
    { start: 1, end: 4, text: 'one' }, { start: 30, end: 33, text: 'two' },
    { start: 61, end: 64, text: 'three' }, { start: 185, end: 190.2, text: 'four' },
  ];
  const units = groupCuesIntoUnits(cues, 60);
  assert.deepEqual(units.map(u => [u.index, u.text, u.startSec, u.endSec]), [[1, 'one two', 1, 33], [2, 'three', 61, 64], [3, 'four', 185, 191]]);
});

test('timestamps format as m:ss and h:mm:ss; locations show the time range', () => {
  assert.equal(formatTimestamp(83), '1:23');
  assert.equal(formatTimestamp(3725), '1:02:05');
  assert.equal(formatTimestamp(0), '0:00');
  assert.equal(formatLocation({ t: 83 }), '1:23');
  assert.equal(formatLocation({ tStart: 83, tEnd: 185 }), '1:23–3:05');
  assert.equal(formatLocation({ tStart: 83, tEnd: 83.4 }), '1:23');
});

const SPEECH = [
  'so today we are going to talk about normalization which is the process of organizing the columns and tables of a database to minimize redundancy',
  'and the reason we care is that redundant data causes update anomalies when a single fact is stored in many places and only some copies change',
  'a functional dependency is a constraint between two sets of attributes in a relation and every normal form is defined in terms of it',
  'candidate key refers to a minimal set of attributes that uniquely identifies every tuple so each relation always has at least one candidate key',
  'next we will look at first normal form which needs every attribute to hold only atomic values and no repeating groups at all',
];
const transcriptUnits = () => SPEECH.map((text, i) => ({ index: i + 1, text, startSec: i * 60, endSec: i * 60 + 55 }));

test('segmentTranscript: time-window sections headed and located by seconds, in order', () => {
  const sections = segmentTranscript(transcriptUnits());
  assert.ok(sections.length >= 1);
  assert.equal(sections[0].heading, '0:00–' + formatTimestamp((sections[0].location as { tEnd: number }).tEnd));
  assert.deepEqual(sections.map(s => s.ordinal), sections.map((_, i) => i));
  for (let i = 1; i < sections.length; i++) assert.ok((sections[i].location as { tStart: number }).tStart >= (sections[i - 1].location as { tStart: number }).tStart);
  assert.equal(sections.map(s => s.text).join(' ').includes('first normal form'), true);
  assert.deepEqual(segmentUnits(transcriptUnits(), 'youtube', 'x'), sections, 'segmentUnits routes youtube to segmentTranscript');
});

test('segmentTranscript: a tiny trailing window is folded into the previous section', () => {
  const units = [
    { index: 1, text: 'x'.repeat(1600), startSec: 0, endSec: 60 },
    { index: 2, text: 'short tail', startSec: 60, endSec: 70 },
  ];
  const sections = segmentTranscript(units);
  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].location, { tStart: 0, tEnd: 70 });
  assert.deepEqual(segmentTranscript([]), []);
});

test('transcript terms: definitions are found in run-on caption text only when a sentence is recognisable; frequent phrases still surface', () => {
  const units = normalizeUnits(transcriptUnits().map(u => ({ ...u, text: u.text.charAt(0).toUpperCase() + u.text.slice(1) + '.' })), { stripRepeated: false });
  const terms = extractTerms(segmentTranscript(units));
  const names = terms.map(t => t.term.toLowerCase());
  assert.ok(names.includes('candidate key'), names.join('|'));
  assert.ok(terms.every(t => 'tStart' in t.location));
});

test('playlist and page parsing', () => {
  const html = '<meta property="og:title" content="DBMS &amp; SQL - YouTube"><script>{"playlistVideoRenderer":{"videoId":"aaaaaaaaaaa","thumbnail":{}}},{"playlistVideoRenderer":{"videoId":"bbbbbbbbbbb"}},{"playlistVideoRenderer":{"videoId":"aaaaaaaaaaa"}}</script>';
  assert.deepEqual(extractPlaylistVideoIds(html), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.equal(extractPageTitle(html), 'DBMS & SQL');
  assert.deepEqual(extractPlaylistVideoIds('<html></html>'), []);
  assert.equal(extractPageTitle('<html></html>'), null);
});

test('youtubeLinkAt: opens the video at the section start', () => {
  const url = 'https://www.youtube.com/watch?v=abcdefghijk';
  assert.equal(youtubeLinkAt(url, { tStart: 125.7, tEnd: 200 }), `${url}&t=125s`);
  assert.equal(youtubeLinkAt(url, { t: 30 }), `${url}&t=30s`);
  assert.equal(youtubeLinkAt(url, { tStart: 0, tEnd: 5 }), url);
  assert.equal(youtubeLinkAt(url, {}), url);
  assert.equal(youtubeLinkAt(url, null), url);
});
