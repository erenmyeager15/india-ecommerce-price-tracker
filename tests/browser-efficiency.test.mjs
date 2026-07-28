import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldBlockBrowserResource } from '../dist/browser-efficiency.js';

test('browser sources block heavy assets but keep scripts and API requests', () => {
  assert.equal(shouldBlockBrowserResource('image'), true);
  assert.equal(shouldBlockBrowserResource('media'), true);
  assert.equal(shouldBlockBrowserResource('font'), true);
  assert.equal(shouldBlockBrowserResource('script'), false);
  assert.equal(shouldBlockBrowserResource('xhr'), false);
  assert.equal(shouldBlockBrowserResource('fetch'), false);
  assert.equal(shouldBlockBrowserResource('document'), false);
});
