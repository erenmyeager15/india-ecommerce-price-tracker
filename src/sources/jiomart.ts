import { PlaywrightCrawler } from 'crawlee';
import type { ProductRecord, SourceContext } from '../types.js';
import { absoluteUrl, appendProductCandidates, cleanText, discountFromPrices, numberOrNull, redactText, withDefaults } from '../utils.js';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject | null {
  return isObject(value) ? value : null;
}

function getPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) return cleanText(value[0]);
  return cleanText(value);
}

function buildHomeUrl(query: string): string {
  return `https://www.jiomart.com/?search=${encodeURIComponent(query)}`;
}

function buildProductsUrl(query: string): string {
  return `https://www.jiomart.com/products?q=${encodeURIComponent(query)}`;
}

function isBlockedText(title: string, body: string): boolean {
  return /access denied|request blocked|verify you are human|just a moment|captcha/i.test(`${title}\n${body}`);
}

function extractPackSize(item: JsonObject, attributes: JsonObject | null, title: string): string | null {
  const structured = firstString(attributes?.['product-size']) ?? firstString(item.sizes);
  if (structured && !['os', 'one size', 'one-size', 'na', 'n/a'].includes(structured.toLowerCase())) return structured;
  const match = title.match(/(?:^|[^0-9.])(\d+(?:\.\d+)?\s*(?:kg|kgs|g|gm|gram|grams|ml|l|ltr|litre|litres|liter|liters|pcs|pc|pieces|pack|packs)\b)/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? structured;
}

function extractProducts(payloads: Array<{ url: string; json: unknown }>, searchQuery: string): ProductRecord[] {
  const products = new Map<string, ProductRecord>();
  let position = 0;
  for (const payload of payloads) {
    const root = asObject(payload.json);
    const items = Array.isArray(root?.items) ? root.items : [];
    for (const rawItem of items) {
      if (!isObject(rawItem) || rawItem.type !== 'product') continue;
      const title = redactText(rawItem.name);
      const price = numberOrNull(getPath(rawItem, ['price', 'effective', 'min']));
      if (!title || price === null) continue;
      const productId = cleanText(rawItem.uid ?? rawItem.sku_code ?? rawItem.item_code);
      if (!productId || products.has(productId)) continue;
      const mrp = numberOrNull(getPath(rawItem, ['price', 'marked', 'min']));
      const hierarchy = asObject(rawItem.hierarchy);
      const l1 = asObject(hierarchy?.l1_category);
      const l2 = asObject(hierarchy?.l2_category);
      const attributes = asObject(rawItem.attributes);
      const medias = Array.isArray(rawItem.medias) ? rawItem.medias : [];
      const firstMedia = asObject(medias[0]);
      const stockVariantIds = getPath(rawItem, ['instock_variants', 'item_id']);
      const sellable = typeof rawItem.sellable === 'boolean' ? rawItem.sellable : null;
      const inStock = sellable !== false && (!Array.isArray(stockVariantIds) || stockVariantIds.length > 0);
      position += 1;
      products.set(productId, withDefaults({
        source: 'jiomart',
        searchQuery,
        position,
        productId,
        title,
        brand: redactText(getPath(rawItem, ['brand', 'name'])),
        price,
        mrp,
        discountPercent: numberOrNull(rawItem.discount) ?? discountFromPrices(price, mrp),
        currency: cleanText(getPath(rawItem, ['price', 'currency_code'])) ?? 'INR',
        packSize: extractPackSize(rawItem, attributes, title),
        category: redactText(l2?.name ?? l1?.name ?? firstString(attributes?.['l1-category'])),
        rating: numberOrNull(rawItem.rating),
        ratingCount: null,
        inStock,
        imageUrl: absoluteUrl(cleanText(firstMedia?.url), 'https://www.jiomart.com'),
        productUrl: absoluteUrl(cleanText(rawItem.slug) ? `/p/${cleanText(rawItem.slug)}` : null, 'https://www.jiomart.com'),
      }));
    }
  }
  return [...products.values()];
}

export async function scrapeJioMart(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
  const requests = context.input.searchQueries.map((searchQuery) => ({
    url: buildHomeUrl(searchQuery),
    uniqueKey: `jiomart-${searchQuery.toLowerCase()}`,
    userData: { searchQuery },
  }));

  const crawler = new PlaywrightCrawler({
    proxyConfiguration: context.proxyConfiguration as any,
    headless: false,
    maxConcurrency: 1,
    minConcurrency: 1,
    maxRequestRetries: 2,
    retryOnBlocked: true,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 300,
    maxRequestsPerCrawl: requests.length,
    sessionPoolOptions: {
      maxPoolSize: 30,
      blockedStatusCodes: [],
      sessionOptions: { maxUsageCount: 10 },
    },
    browserPoolOptions: { useFingerprints: true },
    launchContext: {
      useChrome: true,
      launchOptions: { args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'] },
    },
    preNavigationHooks: [async ({ page }, gotoOptions) => {
      await page.context().grantPermissions(['geolocation'], { origin: 'https://www.jiomart.com' });
      await page.context().setGeolocation({ latitude: context.input.latitude, longitude: context.input.longitude });
      await page.setExtraHTTPHeaders({ 'accept-language': 'en-IN,en;q=0.9' });
      page.setDefaultTimeout(15_000);
      if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';
    }],
    requestHandler: async ({ page, request, session }) => {
      if (records.length >= context.maxResults) return;
      const { searchQuery } = request.userData as { searchQuery: string };
      const payloads: Array<{ url: string; json: unknown }> = [];
      const responseTasks = new Set<Promise<void>>();
      const responseHandler = (response: any): void => {
        const url = response.url();
        if (response.status() !== 200 || !url.includes('/ext/vertex/application/api/v1.0/products')) return;
        const task = response.json().then((json: unknown) => { payloads.push({ url, json }); }).catch(() => undefined)
          .finally(() => { responseTasks.delete(task); });
        responseTasks.add(task);
      };
      page.on('response', responseHandler);
      await page.waitForLoadState('domcontentloaded', { timeout: 90_000 }).catch(() => undefined);
      await page.waitForTimeout(3_000);
      let title = await page.title();
      let body = await page.locator('body').innerText().catch(() => '');
      if (isBlockedText(title, body)) {
        session?.markBad();
        throw new Error(`JioMart challenge page detected for ${request.url}`);
      }
      const searchInput = page.locator('input[placeholder*="Search"], input[type="text"]').first();
      if (await searchInput.count()) {
        await searchInput.fill(searchQuery);
        await Promise.all([
          page.waitForURL(/\/products\?q=/, { timeout: 30_000 }).catch(() => undefined),
          searchInput.press('Enter'),
        ]);
      }
      await page.waitForTimeout(5_000);
      if (payloads.length === 0) {
        await page.goto(buildProductsUrl(searchQuery), { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.waitForTimeout(5_000);
      }
      let idleRounds = 0;
      for (let round = 0; round < context.input.maxPagesPerQuery * 3 && payloads.length < context.input.maxPagesPerQuery; round += 1) {
        const before = payloads.length;
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1_400 + Math.floor(Math.random() * 1_200));
        idleRounds = payloads.length === before ? idleRounds + 1 : 0;
        if (idleRounds >= 3) break;
      }
      await Promise.allSettled([...responseTasks]);
      page.off('response', responseHandler);
      title = await page.title();
      body = await page.locator('body').innerText().catch(() => '');
      if (isBlockedText(title, body)) {
        session?.markBad();
        throw new Error(`JioMart challenge page after search for ${searchQuery}`);
      }
      const products = extractProducts(payloads.slice(0, context.input.maxPagesPerQuery), searchQuery);
      appendProductCandidates(records, products, searchQuery, context.maxResults, context.maxResultsPerQuery);
    },
    failedRequestHandler: async ({ request }, error) => {
      console.warn(`JioMart request failed: ${request.url} ${String(error)}`);
    },
  });

  await crawler.run(requests);
  return records;
}
