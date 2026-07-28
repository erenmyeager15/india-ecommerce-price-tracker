import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInput } from '../dist/input.js';

test('runtime defaults match the bounded Store QA prefill', () => {
  const input = normalizeInput({});
  assert.deepEqual(input.sources, ['bigbasket']);
  assert.equal(input.searchQueries[0], 'milk');
  assert.equal(input.maxResults, 1);
  assert.equal(input.maxPagesPerQuery, 1);
  assert.deepEqual(input.proxyConfiguration.apifyProxyGroups, ['RESIDENTIAL']);
  assert.equal(input.proxyConfiguration.apifyProxyCountry, 'IN');
});

test('structured product targets become focused source queries', () => {
  const input = normalizeInput({
    targetProducts: [{ name: 'Amul Gold Milk', brand: 'Amul', packSize: '1 L' }],
    searchQueries: ['ignored broad query'],
  });
  assert.deepEqual(input.searchQueries, ['Amul Gold Milk 1 L']);
  assert.equal(input.targetProducts[0].brand, 'Amul');
});

test('broad query mode creates fallback product targets', () => {
  const input = normalizeInput({ searchQueries: ['wireless earbuds'], proxyConfiguration: { useApifyProxy: false } });
  assert.equal(input.targetProducts[0].name, 'wireless earbuds');
  assert.equal(input.proxyConfiguration.useApifyProxy, false);
});

test('source names are case-insensitive and deduplicated', () => {
  const input = normalizeInput({ sources: ['BIGBASKET', 'bigbasket', 'Myntra'] });
  assert.deepEqual(input.sources, ['bigbasket', 'myntra']);
});

test('unsupported and empty source lists are rejected', () => {
  assert.throws(() => normalizeInput({ sources: ['amazon'] }), /unsupported source/i);
  assert.throws(() => normalizeInput({ sources: ['blinkit'] }), /unsupported source/i);
  assert.throws(() => normalizeInput({ sources: ['jiomart'] }), /unsupported source/i);
  assert.throws(() => normalizeInput({ sources: ['aliexpress'] }), /unsupported source/i);
  assert.throws(() => normalizeInput({ sources: [] }), /at least 1 item/i);
});

test('numeric run limits must be bounded integers', () => {
  assert.throws(() => normalizeInput({ maxResults: 1.5 }), /integer/i);
  assert.throws(() => normalizeInput({ maxResults: 1001 }), /between 1 and 1000/i);
  assert.throws(() => normalizeInput({ maxPagesPerQuery: 0 }), /between 1 and 25/i);
});

test('price range and coordinates are validated', () => {
  assert.throws(() => normalizeInput({ minPrice: 500, maxPrice: 100 }), /greater than or equal/i);
  assert.throws(() => normalizeInput({ latitude: 91 }), /between -90 and 90/i);
  assert.throws(() => normalizeInput({ longitude: -181 }), /between -180 and 180/i);
});

test('unknown input and target fields are rejected', () => {
  assert.throws(() => normalizeInput({ surprise: true }), /unsupported input field/i);
  assert.throws(() => normalizeInput({ targetProducts: [{ name: 'Milk', sku: 'secret' }] }), /unsupported field/i);
});

test('custom proxy URLs are accepted without Apify proxy settings', () => {
  const input = normalizeInput({ proxyConfiguration: { proxyUrls: ['https://proxy.example:8443'] } });
  assert.equal(input.proxyConfiguration.useApifyProxy, false);
  assert.deepEqual(input.proxyConfiguration.proxyUrls, ['https://proxy.example:8443/']);
});

test('invalid or unknown proxy configuration is rejected', () => {
  assert.throws(() => normalizeInput({ proxyConfiguration: { proxyUrls: ['socks5://proxy.example'] } }), /valid HTTP or HTTPS/i);
  assert.throws(() => normalizeInput({ proxyConfiguration: { useApifyProxy: true, secret: 'x' } }), /unsupported field/i);
});

test('brand filters are normalized and deduplicated', () => {
  const input = normalizeInput({ brands: ['Amul', ' amul ', 'Mother Dairy'] });
  assert.deepEqual([...input.brands], ['amul', 'mother dairy']);
});
