import assert from 'node:assert/strict';
import test from 'node:test';
import { HTTP_REQUEST_ATTEMPTS, proxyUrlForAttempt } from '../dist/request-strategy.js';

test('HTTP requests try direct access before using the fallback proxy', async () => {
  const sessions = [];
  const proxyConfiguration = {
    async newUrl(sessionId) {
      sessions.push(sessionId);
      return `http://proxy.example/${sessionId}`;
    },
  };

  assert.equal(HTTP_REQUEST_ATTEMPTS, 3);
  assert.equal(await proxyUrlForAttempt(proxyConfiguration, 'bigbasket_0_1', 1), undefined);
  assert.equal(
    await proxyUrlForAttempt(proxyConfiguration, 'bigbasket_0_1', 2),
    'http://proxy.example/bigbasket_0_1_proxy_1',
  );
  assert.deepEqual(sessions, ['bigbasket_0_1_proxy_1']);
});

test('HTTP retries remain direct when no fallback proxy is configured', async () => {
  assert.equal(await proxyUrlForAttempt(undefined, 'flipkart', 2), undefined);
});
