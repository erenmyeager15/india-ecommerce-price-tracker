import { Actor, log } from 'apify';
import type { ActorInput, NormalizedInput, ProductRecord, SourceName, SourceRunner } from './types.js';
import { hasForbiddenField, shouldKeepProduct, uniqueStrings } from './utils.js';
import { scrapeAliExpress } from './sources/aliexpress.js';
import { scrapeBigBasket } from './sources/bigbasket.js';
import { scrapeBlinkit } from './sources/blinkit.js';
import { scrapeFlipkart } from './sources/flipkart.js';
import { scrapeJioMart } from './sources/jiomart.js';
import { scrapeMeesho } from './sources/meesho.js';
import { scrapeMyntra } from './sources/myntra.js';

const CHARGE_EVENT = 'product-scraped';
const ALL_SOURCES: SourceName[] = ['flipkart', 'myntra', 'bigbasket', 'blinkit', 'jiomart', 'meesho', 'aliexpress'];
const RUNNERS: Record<SourceName, SourceRunner> = {
  flipkart: scrapeFlipkart,
  myntra: scrapeMyntra,
  bigbasket: scrapeBigBasket,
  blinkit: scrapeBlinkit,
  jiomart: scrapeJioMart,
  meesho: scrapeMeesho,
  aliexpress: scrapeAliExpress,
};

function normalizeSources(values: unknown): SourceName[] {
  if (!Array.isArray(values)) return ['flipkart', 'myntra', 'bigbasket', 'meesho'];
  const set = new Set(ALL_SOURCES);
  const sources = values.map((value) => String(value).trim().toLowerCase()).filter((value): value is SourceName => set.has(value as SourceName));
  return sources.length ? [...new Set(sources)] : ['flipkart', 'myntra', 'bigbasket', 'meesho'];
}

function normalizeInput(raw: ActorInput): NormalizedInput {
  const minPrice = Math.max(Number(raw.minPrice ?? 0), 0);
  const maxPrice = Math.max(Number(raw.maxPrice ?? 1_000_000), minPrice);
  return {
    sources: normalizeSources(raw.sources),
    searchQueries: uniqueStrings(raw.searchQueries ?? ['milk']),
    city: String(raw.city ?? 'Mumbai').trim() || 'Mumbai',
    latitude: Number.isFinite(raw.latitude) ? Number(raw.latitude) : 19.076,
    longitude: Number.isFinite(raw.longitude) ? Number(raw.longitude) : 72.8777,
    brands: new Set(uniqueStrings(raw.brands ?? []).map((item) => item.toLowerCase())),
    minPrice,
    maxPrice,
    inStockOnly: raw.inStockOnly === true,
    maxResults: Math.min(Math.max(Math.floor(Number(raw.maxResults ?? 50)), 1), 1000),
    maxPagesPerQuery: Math.min(Math.max(Math.floor(Number(raw.maxPagesPerQuery ?? 2)), 1), 25),
    proxyConfiguration: raw.proxyConfiguration ?? {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
      apifyProxyCountry: 'IN',
    },
  };
}

function uniqueKey(record: ProductRecord): string | null {
  return record.productId ? `${record.source}:${record.productId}` : record.productUrl ? `${record.source}:${record.productUrl}` : null;
}

await Actor.init();

try {
  const input = normalizeInput((await Actor.getInput<ActorInput>()) ?? {});
  if (input.searchQueries.length === 0) throw new Error('Provide at least one search query.');

  const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration as never);
  const seen = new Set<string>();
  let saved = 0;
  let eventChargeLimitReached = false;
  const perSourceLimit = Math.max(1, Math.ceil(input.maxResults / input.sources.length));

  log.info('Starting India E-commerce Price Tracker', {
    sources: input.sources,
    searchQueries: input.searchQueries,
    maxResults: input.maxResults,
    perSourceLimit,
  });

  for (const source of input.sources) {
    if (saved >= input.maxResults || eventChargeLimitReached) break;
    const sourceLimit = Math.min(perSourceLimit, input.maxResults - saved);
    const runner = RUNNERS[source];
    let records: ProductRecord[] = [];

    try {
      records = await runner({ input, maxResults: sourceLimit, proxyConfiguration });
      log.info(`Source ${source} returned ${records.length} candidate products.`);
    } catch (error) {
      log.warning(`Source ${source} failed; continuing with remaining sources.`, { error: (error as Error).message });
      continue;
    }

    for (const record of records) {
      if (saved >= input.maxResults || eventChargeLimitReached) break;
      if (hasForbiddenField(record)) {
        log.warning(`Skipped ${source} product with forbidden output field.`);
        continue;
      }
      if (!shouldKeepProduct(record, input)) continue;
      const key = uniqueKey(record);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      await Actor.pushData(record);
      const chargeResult = await Actor.charge({ eventName: CHARGE_EVENT });
      saved += 1;
      if (chargeResult.eventChargeLimitReached) {
        eventChargeLimitReached = true;
        log.warning('User spending limit reached after saving the last product. Stopping.');
        break;
      }
    }

    await Actor.setStatusMessage(`Saved ${saved}/${input.maxResults} products after ${source}`);
  }

  log.info(`Finished India E-commerce Price Tracker with ${saved} clean product records.`);
} finally {
  await Actor.exit();
}

