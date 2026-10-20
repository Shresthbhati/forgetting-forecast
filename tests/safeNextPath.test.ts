import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNextPath } from '../src/lib/safeNextPath.ts';

const origin = 'https://app.example.com';

test('safeNextPath keeps same-site relative paths', () => {
  assert.equal(safeNextPath('/library', origin), '/library');
  assert.equal(safeNextPath('/concepts/abc?tab=history', origin), '/concepts/abc?tab=history');
});

test('safeNextPath rejects every open-redirect form and falls back to /', () => {
  for (const bad of ['@evil.com', '//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '', null, undefined, 'evil.com']) {
    assert.equal(safeNextPath(bad as string | null | undefined, origin), '/', `should reject ${String(bad)}`);
  }
});

test('the exact attack from the audit (?next=@evil.com) cannot change the host', () => {
  // The old code built `${origin}${next}` = https://app.example.com@evil.com, whose host is evil.com.
  const target = new URL(safeNextPath('@evil.com', origin), origin);
  assert.equal(target.origin, origin);
});
