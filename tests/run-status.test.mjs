import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSourceStatusDocument, noResultsError, safeErrorMessage } from '../dist/run-status.js';

test('source errors redact URL credentials and secret query values', () => {
  const safe = safeErrorMessage(new Error('GET https://user:pass@example.com/a?api_key=secret&token=other failed'));
  assert.doesNotMatch(safe, /user:pass|secret|other/);
  assert.match(safe, /\[redacted\]/);
});

test('source status document preserves per-source diagnostics', () => {
  const document = buildSourceStatusDocument([
    { source: 'bigbasket', outcome: 'results', candidates: 2, saved: 1, durationMillis: 1200 },
  ], 1, false);
  assert.equal(document.savedRecords, 1);
  assert.equal(document.sources[0].saved, 1);
});

test('no-result error includes source outcomes without hiding partial failures', () => {
  const error = noResultsError([
    { source: 'bigbasket', outcome: 'empty', candidates: 0, saved: 0, durationMillis: 10 },
    { source: 'myntra', outcome: 'failed', candidates: 0, saved: 0, durationMillis: 20, error: 'blocked' },
  ]);
  assert.match(error.message, /bigbasket: empty/);
  assert.match(error.message, /myntra: failed \(blocked\)/);
});
