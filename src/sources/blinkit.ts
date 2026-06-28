import { PlaywrightCrawler } from 'crawlee';
import type { ProductRecord, SourceContext } from '../types.js';
import { cleanText, discountFromPrices, numberOrNull, parseCompactCount, slugify, withDefaults } from '../utils.js';

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

function isBlockedText(title: string, body: string): boolean {
  return /access denied|just a moment|verify you are human|cf-chl-|request blocked|captcha/i.test(`${title}\n${body}`);
}

function extractProducts(payloads: unknown[], searchQuery: string): ProductRecord[] {
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
      const mrp = numberOrNull(cartItem.mrp);
      if (price !== null) {
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
    maxRequestRetries: 2,
    retryOnBlocked: true,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 240,
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
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => undefined);
      await page.waitForTimeout(5_000);
      const title = await page.title();
      const body = await page.locator('body').innerText().catch(() => '');
      if (isBlockedText(title, body)) {
        session?.markBad();
        throw new Error(`Blinkit challenge page detected for ${request.url}`);
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
      page.off('response', responseHandler);
      const products = extractProducts(payloads.slice(0, context.input.maxPagesPerQuery), searchQuery);
      records.push(...products.slice(0, context.maxResults - records.length));
    },
    failedRequestHandler: async ({ request }, error) => {
      console.warn(`Blinkit request failed: ${request.url} ${String(error)}`);
    },
  });

  await crawler.run(requests);
  return records;
}
