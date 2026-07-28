import { PlaywrightCrawler } from 'crawlee';
import type { ProductRecord, SourceContext } from '../types.js';
import { blockHeavyBrowserResources } from '../browser-efficiency.js';
import { appendProductCandidates, cleanText, discountFromPrices, numberOrNull, parseCompactCount, slugify, withDefaults } from '../utils.js';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject | null {
  return isObject(value) ? value : null;
}

function textValue(value: unknown): string | null {
  return cleanText(asObject(value)?.text);
}

function findCartItem(candidate: JsonObject): JsonObject | null {
  const atcAction = asObject(candidate.atc_action);
  const addToCart = asObject(atcAction?.add_to_cart);
  return asObject(addToCart?.cart_item);
}

function buildSearchUrl(query: string): string {
  return `https://blinkit.com/s/?q=${encodeURIComponent(query)}`;
}

export function isBlinkitBlockedText(title: string, body: string): boolean {
  return /access denied|just a moment|verify you are human|cf-chl-|request blocked|captcha/i.test(`${title}\n${body}`);
}

export function isBlinkitExplicitEmptyText(body: string): boolean {
  return /no products? found|no results? found|couldn't find any products|try searching for something else/i.test(body);
}

export function extractBlinkitProducts(payloads: unknown[], searchQuery: string): ProductRecord[] {
  const products = new Map<string, ProductRecord>();
  let position = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isObject(value)) return;
    const cartItem = findCartItem(value);
    const productId = cleanText(cartItem?.product_id);
    const title = cleanText(cartItem?.product_name) ?? textValue(value.display_name) ?? textValue(value.name);
    if (cartItem && productId && title && !products.has(productId)) {
      const price = numberOrNull(cartItem.price);
      if (price !== null) {
        const candidateMrp = numberOrNull(cartItem.mrp);
        const mrp = candidateMrp !== null && candidateMrp >= price ? candidateMrp : null;
        position += 1;
        const inventory = numberOrNull(cartItem.inventory);
        const ratingBar = asObject(asObject(value.rating)?.bar);
        const soldOut = value.is_sold_out === true || value.product_state === 'sold_out';
        products.set(productId, withDefaults({
          source: 'blinkit',
          searchQuery,
          position,
          productId,
          title,
          brand: cleanText(cartItem.brand) ?? textValue(value.brand_name),
          price,
          mrp,
          discountPercent: discountFromPrices(price, mrp),
          currency: 'INR',
          packSize: cleanText(cartItem.unit) ?? textValue(value.variant),
          category: null,
          rating: numberOrNull(ratingBar?.value),
          ratingCount: parseCompactCount(textValue(ratingBar?.title)),
          inStock: !soldOut && (inventory === null || inventory > 0),
          imageUrl: cleanText(cartItem.image_url) ?? cleanText(asObject(value.image)?.url),
          productUrl: `https://blinkit.com/prn/${slugify(title)}/prid/${productId}`,
        }));
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  for (const payload of payloads) visit(payload);
  return [...products.values()];
}

export async function scrapeBlinkit(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
  let failedRequestCount = 0;
  let usableRequestCount = 0;
  const requests = context.input.searchQueries.map((searchQuery) => ({
    url: buildSearchUrl(searchQuery),
    uniqueKey: `blinkit-${searchQuery.toLowerCase()}`,
    userData: { searchQuery },
  }));

  const crawler = new PlaywrightCrawler({
    proxyConfiguration: context.proxyConfiguration as any,
    headless: false,
    maxConcurrency: 1,
    minConcurrency: 1,
    maxRequestRetries: 0,
    maxSessionRotations: 1,
    retryOnBlocked: true,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,
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
      await blockHeavyBrowserResources(page);
      await page.context().grantPermissions(['geolocation'], { origin: 'https://blinkit.com' });
      await page.context().setGeolocation({ latitude: context.input.latitude, longitude: context.input.longitude });
      await page.setExtraHTTPHeaders({ 'accept-language': 'en-IN,en;q=0.9' });
      page.setDefaultTimeout(15_000);
      if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';
    }],
    requestHandler: async ({ page, request, session }) => {
      if (records.length >= context.maxResults) return;
      const { searchQuery } = request.userData as { searchQuery: string };
      const payloads: unknown[] = [];
      const responseTasks = new Set<Promise<void>>();
      const responseHandler = (response: any): void => {
        const url = response.url();
        if (response.status() !== 200 || !url.includes('/v1/layout/search')) return;
        const task = response.json().then((payload: unknown) => { payloads.push(payload); }).catch(() => undefined)
          .finally(() => { responseTasks.delete(task); });
        responseTasks.add(task);
      };
      page.on('response', responseHandler);
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 90_000 }).catch(() => undefined);
        await page.waitForTimeout(3_000);
        let title = await page.title();
        let body = await page.locator('body').innerText().catch(() => '');
        if (isBlinkitBlockedText(title, body)) {
          session?.markBad();
          throw new Error(`Blinkit challenge page detected for ${request.url}`);
        }
        if (payloads.length === 0 && !body.toLowerCase().includes(searchQuery.toLowerCase())) {
          await page.waitForTimeout(5_000);
          title = await page.title();
          body = await page.locator('body').innerText().catch(() => '');
        }
        if (isBlinkitBlockedText(title, body)) {
          session?.markBad();
          throw new Error(`Blinkit challenge page detected for ${request.url}`);
        }
        if (payloads.length === 0 && isBlinkitExplicitEmptyText(body)) {
          usableRequestCount += 1;
          return;
        }
        if (payloads.length === 0 && !body.toLowerCase().includes(searchQuery.toLowerCase())) {
          throw new Error(`Blinkit did not return a usable search page for "${searchQuery}".`);
        }
        let idleRounds = 0;
        for (let round = 0; round < context.input.maxPagesPerQuery * 3 && payloads.length < context.input.maxPagesPerQuery; round += 1) {
          const before = payloads.length;
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1_200 + Math.floor(Math.random() * 1_300));
          idleRounds = payloads.length === before ? idleRounds + 1 : 0;
          if (idleRounds >= 3) break;
        }
        await Promise.allSettled([...responseTasks]);
        const products = extractBlinkitProducts(payloads.slice(0, context.input.maxPagesPerQuery), searchQuery);
        if (products.length === 0 && isBlinkitExplicitEmptyText(body)) {
          usableRequestCount += 1;
          return;
        }
        if (products.length === 0) {
          session?.markBad();
          throw new Error(`No Blinkit product records found for "${searchQuery}".`);
        }
        appendProductCandidates(records, products, searchQuery, context.maxResults, context.maxResultsPerQuery);
        usableRequestCount += 1;
      } finally {
        await Promise.allSettled([...responseTasks]);
        page.off('response', responseHandler);
      }
    },
    failedRequestHandler: async ({ request }, error) => {
      failedRequestCount += 1;
      console.warn(`Blinkit request failed: ${request.url} ${String(error)}`);
    },
  });

  await crawler.run(requests);
  if (records.length === 0 && failedRequestCount > 0 && usableRequestCount === 0) {
    throw new Error(`Blinkit failed for ${failedRequestCount} request(s) and returned no usable product data.`);
  }
  return records;
}
