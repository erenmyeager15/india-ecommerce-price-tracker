import { Actor, log } from 'apify';
import type { ActorInput, ProductRecord, SourceName, SourceRunner } from './types.js';
import { applyBestProductMatch, buildComparisonReport } from './matching.js';
import { productBillingPreflightIssue, wasPushedRecordSaved } from './billing.js';
import { normalizeInput } from './input.js';
import { buildSourceStatusDocument, noResultsError, safeErrorMessage, type SourceRunStatus } from './run-status.js';
import {
  hasForbiddenField,
  shouldKeepProduct,
  summarizeProducts,
  normalizeProductRecord,
  validateProductRecord,
} from './utils.js';

const CHARGE_EVENT = 'product-scraped';
const RUNNER_LOADERS: Record<SourceName, () => Promise<SourceRunner>> = {
  flipkart: async () => (await import('./sources/flipkart.js')).scrapeFlipkart,
  myntra: async () => (await import('./sources/myntra.js')).scrapeMyntra,
  bigbasket: async () => (await import('./sources/bigbasket.js')).scrapeBigBasket,
  blinkit: async () => (await import('./sources/blinkit.js')).scrapeBlinkit,
  jiomart: async () => (await import('./sources/jiomart.js')).scrapeJioMart,
  meesho: async () => (await import('./sources/meesho.js')).scrapeMeesho,
  aliexpress: async () => (await import('./sources/aliexpress.js')).scrapeAliExpress,
};

function uniqueKey(record: ProductRecord): string | null {
  return record.productId ? `${record.source}:${record.productId}` : record.productUrl ? `${record.source}:${record.productUrl}` : null;
}

async function run(): Promise<void> {
  const input = normalizeInput((await Actor.getInput<ActorInput>()) ?? {});
  const chargingManager = Actor.getChargingManager();
  const pricingInfo = chargingManager.getPricingInfo();
  const eventPriceUsd = pricingInfo.perEventPrices[CHARGE_EVENT];
  const chargeableProductCount = chargingManager.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
  const billingIssue = productBillingPreflightIssue({
    isPayPerEvent: pricingInfo.isPayPerEvent,
    eventPriceUsd,
    chargeableProductCount,
  });
  if (billingIssue) {
    await Actor.setStatusMessage('Stopped before scraping because the run cannot charge for one product.');
    throw new Error(`Billing preflight failed: ${billingIssue}`);
  }

  log.info('Product billing preflight passed.', {
    isPayPerEvent: pricingInfo.isPayPerEvent,
    eventPriceUsd,
    maxTotalChargeUsd: pricingInfo.maxTotalChargeUsd,
    chargeableProductCount: Number.isFinite(chargeableProductCount) ? chargeableProductCount : 'unlimited',
  });

  const proxyConfiguration = input.proxyConfiguration.useApifyProxy || input.proxyConfiguration.proxyUrls?.length
    ? await Actor.createProxyConfiguration(input.proxyConfiguration as never)
    : undefined;
  const seen = new Set<string>();
  const savedRecords: ProductRecord[] = [];
  const sourceStatuses: SourceRunStatus[] = input.sources.map((source) => ({
    source,
    outcome: 'not_run',
    candidates: 0,
    saved: 0,
    durationMillis: 0,
  }));
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
    const runner = await RUNNER_LOADERS[source]();
    const perTargetLimit = Math.max(1, Math.ceil(sourceLimit / input.targetProducts.length));
    let records: ProductRecord[] = [];
    const sourceStartedAt = Date.now();

    try {
      records = await runner({
        input,
        maxResults: sourceLimit,
        maxResultsPerQuery: perTargetLimit,
        proxyConfiguration,
      });
      sourceStatuses[sourceIndex] = {
        source,
        outcome: records.length > 0 ? 'results' : 'empty',
        candidates: records.length,
        saved: 0,
        durationMillis: Date.now() - sourceStartedAt,
      };
      log.info(`Source ${source} returned ${records.length} candidate products.`);
    } catch (error) {
      const safeError = safeErrorMessage(error);
      sourceStatuses[sourceIndex] = {
        source,
        outcome: 'failed',
        candidates: 0,
        saved: 0,
        durationMillis: Date.now() - sourceStartedAt,
        error: safeError,
      };
      log.warning(`Source ${source} failed; continuing with remaining sources.`, { error: safeError });
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
        const recordWasSaved = wasPushedRecordSaved(chargeResult);

        if (recordWasSaved) {
          seen.add(key);
          savedRecords.push(matchedRecord);
          saved += 1;
          sourceStatuses[sourceIndex].saved += 1;
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
  await Actor.setValue('MATCH_REPORT', buildComparisonReport(savedRecords, input), {
    contentType: 'text/markdown; charset=utf-8',
  });
  await Actor.setValue('SOURCE_STATUS', buildSourceStatusDocument(sourceStatuses, saved, eventChargeLimitReached));

  if (saved === 0 && !eventChargeLimitReached) throw noResultsError(sourceStatuses);

  log.info('India E-commerce Price Tracker summary', summarizeProducts(savedRecords, input));
  if (!eventChargeLimitReached) {
    const issueCount = sourceStatuses.filter((status) => status.outcome === 'failed').length;
    await Actor.setStatusMessage(`Finished with ${saved} products${issueCount ? `; ${issueCount} source issue(s)` : ''}`);
  }
  log.info(`Finished India E-commerce Price Tracker with ${saved} clean product records.`);
}

await Actor.init();
try {
  await run();
  await Actor.exit();
} catch (error) {
  log.exception(error instanceof Error ? error : new Error(String(error)), 'India E-commerce Price Tracker failed');
  await Actor.fail(`Failed: ${safeErrorMessage(error)}`);
}
