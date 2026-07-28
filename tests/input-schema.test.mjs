import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schemaUrl = new URL('../INPUT_SCHEMA.json', import.meta.url);
const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));
const exampleInput = JSON.parse(await readFile(new URL('../input.json', import.meta.url), 'utf8'));
const actor = JSON.parse(await readFile(new URL('../.actor/actor.json', import.meta.url), 'utf8'));

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

test('example input and runtime resources stay aligned with QA defaults', () => {
  assert.deepEqual(exampleInput.sources, ['bigbasket']);
  assert.match(exampleInput.targetProducts[0].name, /amul.*milk/i);
  assert.equal(exampleInput.maxResults, 1);
  assert.equal(exampleInput.maxPagesPerQuery, 1);
  assert.equal(exampleInput.proxyConfiguration.useApifyProxy, true);
  assert.deepEqual(exampleInput.proxyConfiguration.apifyProxyGroups, ['RESIDENTIAL']);
  assert.equal(exampleInput.proxyConfiguration.apifyProxyCountry, 'IN');
  assert.equal(actor.defaultRunOptions.memoryMbytes, 1024);
  assert.equal(actor.minMemoryMbytes, 1024);
  assert.equal(actor.maxMemoryMbytes, 1024);
  assert.equal(actor.pricingInfo.pricingPerEvent.actorChargeEvents['apify-actor-start'].eventPriceUsd, 0.00005);
  assert.equal(actor.pricingInfo.pricingPerEvent.actorChargeEvents['product-scraped'].eventPriceUsd, 0.002);
});
