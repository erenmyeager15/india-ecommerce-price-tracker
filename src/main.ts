import { Actor, log } from 'apify';
import type { ActorInput, NormalizedInput, ProductRecord, SourceName, SourceRunner } from './types.js';
import { applyBestProductMatch, buildComparisonReport, normalizeProductTargets } from './matching.js';
import {
  hasForbiddenField,
  normalizeProductRecord,
  shouldKeepProduct,
  summarizeProducts,
  uniqueStrings,
  validateProductRecord,
} from './utils.js';
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
  if (!Array.isArray(values)) return ['myntra'];
  const set = new Set(ALL_SOURCES);
  const sources = values.map((value) => String(value).trim().toLowerCase()).filter((value): value is SourceName => set.has(value as SourceName));
  return sources.length ? [...new Set(sources)] : ['myntra'];
}

function normalizeInput(raw: ActorInput): NormalizedInput {
  const minPrice = Math.max(Number(raw.minPrice ?? 0), 0);
  const maxPrice = Math.max(Number(raw.maxPrice ?? 1_000_000), minPrice);
  const fallbackQueries = uniqueStrings(raw.searchQueries ?? ['kurti']);
  const targetProducts = normalizeProductTargets(raw.targetProducts, fallbackQueries);
  return {
    sources: normalizeSources(raw.sources),
    searchQueries: uniqueStrings(targetProducts.map((target) => target.searchQuery)),
    targetProducts,
    city: String(raw.city ?? 'Mumbai').trim() || 'Mumbai',
    latitude: Number.isFinite(raw.latitude) ? Number(raw.latitude) : 19.076,
    longitude: Number.isFinite(raw.longitude) ? Number(raw.longitude) : 72.8777,
    brands: new Set(uniqueStrings(raw.brands ?? []).map((item) => item.toLowerCase())),
    minPrice,
    maxPrice,
    inStockOnly: raw.inStockOnly === true,
    maxResults: Math.min(Math.max(Math.floor(Number(raw.maxResults ?? 10)), 1), 1000),
    maxPagesPerQuery: Math.min(Math.max(Math.floor(Number(raw.maxPagesPerQuery ?? 1)), 1), 25),
    proxyConfiguration: raw.proxyConfiguration ?? {
      useApifyProxy: false,
    },
  };
}

function uniqueKey(record: ProductRecord): string | null {
  return record.productId ? `${record.source}:${record.productId}` : record.productUrl ? `${record.source}:${record.productUrl}` : null;
}

async function run(): Promise<void> {
  const input = normalizeInput((await Actor.getInput<ActorInput>()) ?? {});
  if (input.searchQueries.length === 0) throw new Error('Provide at least one search query.');

  const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration as never);
  const seen = new Set<string>();
  const savedRecords: ProductRecord[] = [];
  let saved = 0;
  let eventChargeLimitReached = false;
  let fatalBillingError: Error | null = null;
  const initialPerSourceLimit = Math.max(1, Math.ceil(input.maxResults / input.sources.length));

  log.info('Starting India E-commerce Price Tracker', {
    sources: input.sources,
    searchQueries: input.searchQueries,
    targetProducts: input.targetProducts.map((target) => target.name),
    maxResults: input.maxResults,
    perSourceLimit: initialPerSourceLimit,
  });

  for (const [sourceIndex, source] of input.sources.entries()) {
    if (saved >= input.maxResults || eventChargeLimitReached || fatalBillingError) break;
    const remainingCapacity = input.maxResults - saved;
    const remainingSources = input.sources.length - sourceIndex;
    // Recalculate the fair share after every source so unused capacity from an
    // under-delivering source is automatically available to later sources.
    const sourceLimit = Math.max(1, Math.ceil(remainingCapacity / remainingSources));
    const runner = RUNNERS[source];
    const perTargetLimit = Math.max(1, Math.ceil(sourceLimit / input.targetProducts.length));
    let records: ProductRecord[] = [];

    try {
      records = await runner({
        input,
        maxResults: sourceLimit,
        maxResultsPerQuery: perTargetLimit,
        proxyConfiguration,
      });
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
      const normalizedRecord = normalizeProductRecord(record);
      const matchedRecord = applyBestProductMatch(normalizedRecord, input.targetProducts);
      if (!shouldKeepProduct(matchedRecord, input)) continue;
      const validationErrors = validateProductRecord(matchedRecord);
      if (validationErrors.length > 0) {
        log.warning(`Skipped ${source} product with invalid normalized output.`, {
          productId: matchedRecord.productId,
          title: matchedRecord.title,
          validationErrors,
        });
        continue;
      }
      const key = uniqueKey(matchedRecord);
      if (!key || seen.has(key)) continue;

      try {
        const chargeResult = await Actor.pushData(matchedRecord, CHARGE_EVENT);
        const recordWasSaved = chargeResult.chargedCount > 0
          || !chargeResult.eventChargeLimitReached;

        if (recordWasSaved) {
          seen.add(key);
          savedRecords.push(matchedRecord);
          saved += 1;
        }

        if (chargeResult.eventChargeLimitReached) {
          eventChargeLimitReached = true;
          await Actor.setStatusMessage(`Stopped at the user's spending limit after ${saved} products`);
          log.warning('User spending limit reached after saving the last product. Stopping.');
          break;
        }
      } catch (error) {
        fatalBillingError = error instanceof Error ? error : new Error(String(error));
        eventChargeLimitReached = true;
        await Actor.setStatusMessage('Stopped because product output billing failed.');
        log.error('Stopping India E-commerce run because dataset push with product-scraped charge failed.', {
          error: fatalBillingError.message,
        });
        throw fatalBillingError;
      }
    }

    await Actor.setStatusMessage(`Saved ${saved}/${input.maxResults} products after ${source}`);
  }

  if (fatalBillingError) throw fatalBillingError;
  if (saved === 0 && !eventChargeLimitReached) {
    throw new Error('India E-commerce Price Tracker finished with no saved products.');
  }

  await Actor.setValue('MATCH_REPORT', buildComparisonReport(savedRecords, input), {
    contentType: 'text/markdown; charset=utf-8',
  });

  log.info('India E-commerce Price Tracker summary', summarizeProducts(savedRecords, input));
  log.info(`Finished India E-commerce Price Tracker with ${saved} clean product records.`);
}

await Actor.init();
await run();
await Actor.exit();
