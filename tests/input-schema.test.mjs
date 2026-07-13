import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schemaUrl = new URL('../INPUT_SCHEMA.json', import.meta.url);
const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));

test('prefilled QA run is coherent, bounded, and proxy-backed', () => {
  const properties = schema.properties;
  const target = properties.targetProducts.prefill[0];
  const proxy = properties.proxyConfiguration.default;

  assert.deepEqual(properties.sources.default, ['bigbasket']);
  assert.match(target.name, /amul.*milk/i);
  assert.equal(properties.searchQueries.default[0], 'milk');
  assert.equal(properties.maxResults.default, 1);
  assert.equal(properties.maxPagesPerQuery.default, 1);
  assert.equal(proxy.useApifyProxy, true);
  assert.deepEqual(proxy.apifyProxyGroups, ['RESIDENTIAL']);
  assert.equal(proxy.apifyProxyCountry, 'IN');
});
