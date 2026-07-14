import { PlaywrightCrawler } from 'crawlee';
import type { ProductRecord, SourceContext } from '../types.js';
import { appendProductCandidates, cleanText, discountFromPrices, numberOrNull, redactText, withDefaults } from '../utils.js';

type JsonObject = Record<string, unknown>;
export interface JioMartCapturedPayload { url: string; json: unknown }

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
  return Array.isArray(value) ? cleanText(value[0]) : cleanText(value);
}

function pickNumber(item: JsonObject, paths: string[][]): number | null {
  for (const path of paths) {
    const found = numberOrNull(getPath(item, path));
    if (found !== null) return found;
  }
  return null;
}

function pickString(item: JsonObject, paths: string[][]): string | null {
  for (const path of paths) {
    const found = cleanText(getPath(item, path));
    if (found) return found;
  }
  return null;
}

function normalizeJioMartUrl(value: string | null): string | null {
  if (!value) return null;
  const absolute = value.startsWith('//')
    ? `https:${value}`
    : value.startsWith('http://')
      ? `https://${value.slice('http://'.length)}`
      : value.startsWith('https://')
        ? value
        : `https://www.jiomart.com${value.startsWith('/') ? '' : '/'}${value}`;
  try {
    const url = new URL(absolute);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return hostname === 'jiomart.com' ? url.toString() : null;
  } catch {
    return null;
  }
}

const PRICE_PATHS = [
  ['price', 'effective', 'min'], ['price', 'effective'], ['price', 'selling', 'min'],
  ['price', 'selling'], ['price', 'min'], ['sellingPrice'], ['selling_price'],
  ['sale_price'], ['final_price'], ['effective_price'], ['price'],
];
const MRP_PATHS = [
  ['price', 'marked', 'min'], ['price', 'marked'], ['mrp'], ['marked_price'], ['price', 'max'],
];
const NAME_PATHS = [['name'], ['title'], ['product_name'], ['product', 'name']];

function resolvePrice(item: JsonObject): number | null { return pickNumber(item, PRICE_PATHS); }
function resolveMrp(item: JsonObject): number | null { return pickNumber(item, MRP_PATHS); }
function resolveName(item: JsonObject): string | null { return pickString(item, NAME_PATHS); }
function resolveBrand(item: JsonObject): string | null {
  return pickString(item, [['brand', 'name'], ['brand'], ['brand_name']]);
}
function resolveSlug(item: JsonObject): string | null {
  return pickString(item, [['slug'], ['seo', 'slug'], ['url_key']]);
}
function resolveProductUrl(item: JsonObject, slug: string | null): string | null {
  return normalizeJioMartUrl(slug ? `/p/${slug}` : pickString(item, [['url'], ['product_url'], ['action', 'url']]));
}
function resolveImageUrl(item: JsonObject): string | null {
  const medias = Array.isArray(item.medias) ? item.medias : [];
  const mediaUrl = cleanText(asObject(medias[0])?.url);
  if (mediaUrl) return mediaUrl.startsWith('//') ? `https:${mediaUrl}` : mediaUrl;
  const images = Array.isArray(item.images) ? item.images : [];
  const firstImage = images[0];
  const imageUrl = isObject(firstImage) ? cleanText(firstImage.url) : cleanText(firstImage);
  return imageUrl ?? pickString(item, [['image'], ['image_url'], ['imageUrl']]);
}
function resolveCategory(item: JsonObject): string | null {
  const l1 = asObject(getPath(item, ['hierarchy', 'l1_category']));
  const l2 = asObject(getPath(item, ['hierarchy', 'l2_category']));
  const attributes = asObject(item.attributes);
  return cleanText(l2?.name) ?? cleanText(l1?.name) ?? firstString(attributes?.['l1-category'])
    ?? pickString(item, [['category'], ['category_name'], ['l1_category']]);
}
function resolveRating(item: JsonObject): number | null {
  return pickNumber(item, [['rating'], ['rating', 'average'], ['avg_rating'], ['ratings', 'average']]);
}
function resolveInStock(item: JsonObject): boolean | null {
  const sellable = item.sellable ?? item.in_stock ?? item.available ?? item.is_available;
  if (sellable === false) return false;
  const variants = getPath(item, ['instock_variants', 'item_id']);
  if (Array.isArray(variants)) return variants.length > 0;
  return sellable === true ? true : null;
}
function resolveProductId(item: JsonObject, slug: string | null): string | null {
  const raw = item.uid ?? item.sku_code ?? item.item_code ?? item.id ?? item.product_id ?? item.product_code;
  return cleanText(raw) ?? (typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : null) ?? (slug ? `slug:${slug}` : null);
}
function hasIdentity(item: JsonObject): boolean {
  return ['uid', 'sku_code', 'item_code', 'id', 'product_id', 'product_code', 'slug'].some((key) => item[key] !== undefined)
    || item.type === 'product';
}
function isProductItem(item: JsonObject): boolean {
  return resolveName(item) !== null && resolvePrice(item) !== null && hasIdentity(item);
}

const CONTAINER_PATHS = [
  ['items'], ['data', 'items'], ['products'], ['data', 'products'], ['results'], ['data', 'results'],
  ['response', 'items'], ['catalog', 'items'], ['data', 'catalog', 'items'],
];

function looksLikeProductArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.some((entry) => isObject(entry) && isProductItem(entry));
}

function searchForProductArray(node: unknown, depth = 0): unknown[] | null {
  if (depth > 4) return null;
  if (looksLikeProductArray(node)) return node;
  const children = Array.isArray(node) ? node : isObject(node) ? Object.values(node) : [];
  for (const child of children) {
    const found = searchForProductArray(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function findItems(root: JsonObject | null): unknown[] {
  if (!root) return [];
  for (const path of CONTAINER_PATHS) {
    const candidate = getPath(root, path);
    if (looksLikeProductArray(candidate)) return candidate;
  }
  return searchForProductArray(root) ?? [];
}

const QUERY_STOP_WORDS = new Set(['and', 'for', 'from', 'online', 'pack', 'product', 'products', 'the', 'with']);
function normalizeMatchText(value: string): string {
  return value.toLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function queryTokens(query: string): string[] {
  return [...new Set(normalizeMatchText(query).split(' '))]
    .filter((token) => token.length >= 2 && !QUERY_STOP_WORDS.has(token));
}
function tokenMatches(token: string, words: Set<string>): boolean {
  if (words.has(token)) return true;
  const singular = token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token;
  return words.has(singular) || [...words].some((word) => word.endsWith('s') && word.slice(0, -1) === singular);
}
function matchesQuery(item: JsonObject, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const searchable = [resolveName(item), resolveBrand(item), resolveCategory(item), resolveSlug(item)].filter(Boolean).join(' ');
  const words = new Set(normalizeMatchText(searchable).split(' ').filter(Boolean));
  return tokens.some((token) => tokenMatches(token, words));
}

function extractPackSize(item: JsonObject, title: string): string | null {
  const attributes = asObject(item.attributes);
  const structured = firstString(attributes?.['product-size']) ?? firstString(item.sizes);
  if (structured && !['os', 'one size', 'one-size', 'na', 'n/a'].includes(structured.toLowerCase())) return structured;
  return title.match(/(?:^|[^0-9.])(\d+(?:\.\d+)?\s*(?:kg|kgs|g|gm|grams?|ml|l|ltr|litres?|liters?|pcs|pc|pieces|packs?)\b)/i)?.[1]
    ?.replace(/\s+/g, ' ').trim() ?? structured;
}

export function buildJioMartHomeUrl(query: string): string {
  return `https://www.jiomart.com/?search=${encodeURIComponent(query)}`;
}
export function buildJioMartProductsUrl(query: string): string {
  return `https://www.jiomart.com/products?q=${encodeURIComponent(query)}`;
}
export function isJioMartProductsApiUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('product') && (lower.includes('/api/') || lower.includes('/vertex/') || lower.includes('/catalog') || lower.includes('/mst/'));
}
export function isJioMartBlockedText(title: string, body: string): boolean {
  return /access denied|request blocked|verify you are human|just a moment|captcha/i.test(`${title}\n${body}`);
}
export function isJioMartExplicitEmptyText(body: string): boolean {
  return /no products? found|no results? found|couldn't find any products|try another search/i.test(body);
}

export function countRelevantJioMartPayloads(payloads: JioMartCapturedPayload[], searchQuery: string): number {
  const tokens = queryTokens(searchQuery);
  return payloads.filter(({ json }) => findItems(asObject(json)).some((item) => isObject(item) && isProductItem(item) && matchesQuery(item, tokens))).length;
}

export function extractJioMartProducts(payloads: JioMartCapturedPayload[], searchQuery: string): ProductRecord[] {
  const products = new Map<string, ProductRecord>();
  const tokens = queryTokens(searchQuery);
  let position = 0;
  for (const { json } of payloads) {
    for (const rawItem of findItems(asObject(json))) {
      if (!isObject(rawItem) || !isProductItem(rawItem) || !matchesQuery(rawItem, tokens)) continue;
      const title = redactText(resolveName(rawItem));
      const price = resolvePrice(rawItem);
      const slug = resolveSlug(rawItem);
      const productId = resolveProductId(rawItem, slug);
      const productUrl = resolveProductUrl(rawItem, slug);
      if (!title || price === null || !productId || !productUrl || products.has(productId)) continue;
      const rawMrp = resolveMrp(rawItem);
      const mrp = rawMrp !== null && rawMrp > price ? rawMrp : null;
      position += 1;
      products.set(productId, withDefaults({
        source: 'jiomart', searchQuery, position, productId, title,
        brand: redactText(resolveBrand(rawItem)), price, mrp,
        discountPercent: numberOrNull(rawItem.discount) ?? discountFromPrices(price, mrp),
        currency: cleanText(getPath(rawItem, ['price', 'currency_code'])) ?? cleanText(rawItem.currency) ?? 'INR',
        packSize: extractPackSize(rawItem, title), category: redactText(resolveCategory(rawItem)),
        rating: resolveRating(rawItem), ratingCount: null, inStock: resolveInStock(rawItem),
        imageUrl: resolveImageUrl(rawItem), productUrl,
      }));
    }
  }
  return [...products.values()];
}

export async function scrapeJioMart(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
  let failedRequestCount = 0;
  let usableRequestCount = 0;
  const requests = context.input.searchQueries.map((searchQuery) => ({
    url: buildJioMartHomeUrl(searchQuery),
    uniqueKey: `jiomart-${searchQuery.toLowerCase()}`,
    userData: { searchQuery },
  }));

  const crawler = new PlaywrightCrawler({
    proxyConfiguration: context.proxyConfiguration as any,
    headless: false,
    maxConcurrency: 1,
    minConcurrency: 1,
    maxRequestRetries: 3,
    maxSessionRotations: 3,
    retryOnBlocked: true,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 300,
    maxRequestsPerCrawl: requests.length,
    sessionPoolOptions: { maxPoolSize: 30, blockedStatusCodes: [], sessionOptions: { maxUsageCount: 10 } },
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
      const payloads: JioMartCapturedPayload[] = [];
      const responseTasks = new Set<Promise<void>>();
      const responseHandler = (response: any): void => {
        const url = response.url();
        if (response.status() !== 200 || !isJioMartProductsApiUrl(url)) return;
        const task = response.json().then((json: unknown) => { payloads.push({ url, json }); }).catch(() => undefined)
          .finally(() => { responseTasks.delete(task); });
        responseTasks.add(task);
      };
      const settle = async (): Promise<void> => {
        while (responseTasks.size > 0) await Promise.allSettled([...responseTasks]);
      };
      const clear = async (): Promise<void> => { await settle(); payloads.length = 0; };
      page.on('response', responseHandler);
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 90_000 }).catch(() => undefined);
        await page.waitForTimeout(3_000);
        let title = await page.title();
        let body = await page.locator('body').innerText().catch(() => '');
        if (isJioMartBlockedText(title, body)) {
          session?.markBad();
          throw new Error(`JioMart challenge page detected for ${request.url}`);
        }

        const searchInput = page.locator('input[placeholder*="Search"], input[type="text"]').first();
        if (await searchInput.count()) {
          await clear();
          await searchInput.fill(searchQuery);
          await Promise.all([
            page.waitForURL(/\/products\?q=/, { timeout: 30_000 }).catch(() => undefined),
            searchInput.press('Enter'),
          ]);
        }
        await page.waitForTimeout(6_000);
        await settle();
        if (countRelevantJioMartPayloads(payloads, searchQuery) === 0) {
          await clear();
          await page.goto(buildJioMartProductsUrl(searchQuery), { waitUntil: 'domcontentloaded', timeout: 90_000 });
          await page.waitForTimeout(6_000);
          await settle();
        }
        let idleRounds = 0;
        for (let round = 0; round < context.input.maxPagesPerQuery * 3
          && countRelevantJioMartPayloads(payloads, searchQuery) < context.input.maxPagesPerQuery; round += 1) {
          const before = payloads.length;
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1_400 + Math.floor(Math.random() * 1_200));
          idleRounds = payloads.length === before ? idleRounds + 1 : 0;
          if (idleRounds >= 3) break;
        }
        await settle();
        title = await page.title();
        body = await page.locator('body').innerText().catch(() => '');
        if (isJioMartBlockedText(title, body)) {
          session?.markBad();
          throw new Error(`JioMart challenge page after search for "${searchQuery}".`);
        }
        const products = extractJioMartProducts(payloads, searchQuery);
        if (products.length === 0 && isJioMartExplicitEmptyText(body)) {
          usableRequestCount += 1;
          return;
        }
        if (products.length === 0) {
          session?.markBad();
          throw new Error(`No relevant JioMart product records found for "${searchQuery}".`);
        }
        appendProductCandidates(records, products, searchQuery, context.maxResults, context.maxResultsPerQuery);
        usableRequestCount += 1;
      } finally {
        await settle();
        page.off('response', responseHandler);
      }
    },
    failedRequestHandler: async ({ request }, error) => {
      failedRequestCount += 1;
      console.warn(`JioMart request failed: ${request.url} ${String(error)}`);
    },
  });

  await crawler.run(requests);
  if (records.length === 0 && failedRequestCount > 0 && usableRequestCount === 0) {
    throw new Error(`JioMart failed for ${failedRequestCount} request(s) and returned no usable product data.`);
  }
  return records;
}
