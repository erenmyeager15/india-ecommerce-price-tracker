import type { Page } from 'playwright';
import { PlaywrightCrawler } from 'crawlee';
import type { ProductRecord, SourceContext } from '../types.js';
import { blockHeavyBrowserResources } from '../browser-efficiency.js';
import { appendProductCandidates, cleanText, numberOrNull, parseCompactCount, redactText, sleep, withDefaults } from '../utils.js';

function buildSearchUrl(query: string, pageNumber: number): string {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'products';
  const params = new URLSearchParams({ SearchText: query });
  if (pageNumber > 1) params.set('page', String(pageNumber));
  return `https://www.aliexpress.com/w/wholesale-${slug}.html?${params.toString()}`;
}

export function parseAliExpressMoney(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/\u00a0/g, ' ').trim();
  const numeric = normalized.match(/(?:US\s*)?(?:CA\$|AU\$|[$\u20ac\u00a3\u20b9])\s*(\d[\d,]*(?:\.\d+)?)/i)?.[1]
    ?? normalized.match(/\d[\d,]*(?:\.\d+)?/)?.[0];
  return numberOrNull(numeric);
}

export function parseAliExpressDiscount(value: string | null): number | null {
  const parsed = numberOrNull(value?.match(/(\d{1,3})\s*%/)?.[1]);
  return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : null;
}

export function parseAliExpressRating(value: string | null): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed >= 0 && parsed <= 5 ? parsed : null;
}

export function aliExpressCurrencyFrom(value: string | null): string {
  if (!value) return 'USD';
  if (value.includes('CA$')) return 'CAD';
  if (value.includes('AU$')) return 'AUD';
  if (/\u20ac|EUR/i.test(value)) return 'EUR';
  if (/\u00a3|GBP/i.test(value)) return 'GBP';
  if (/\u20b9|INR|\bRs\.?\b/i.test(value)) return 'INR';
  return 'USD';
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'proxied content') return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
  return trimmed.startsWith('https://') ? trimmed : null;
}

async function scrollSearchResults(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 1.8, 1200)));
    await page.waitForTimeout(850 + Math.floor(Math.random() * 650));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

export async function isAliExpressBlockedPage(page: Page): Promise<boolean> {
  const state = await page.evaluate(() => ({
    title: document.title,
    body: document.body?.innerText?.slice(0, 15_000) ?? '',
  }));
  return /captcha|robot|security verification|unusual traffic|access denied|punish/i.test(`${state.title}\n${state.body}`);
}

export function isAliExpressExplicitEmptyText(body: string): boolean {
  return /no results? found|we couldn't find|try a different search|0 results/i.test(body);
}

export async function extractAliExpressProducts(page: Page, searchQuery: string, pageNumber: number): Promise<ProductRecord[]> {
  const rawProducts = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a.search-card-item[href*="/item/"]')];
    return anchors.map((card) => {
      const title = card.querySelector('h3')?.textContent?.trim()
        || card.querySelector<HTMLElement>('[role="heading"]')?.getAttribute('aria-label')
        || card.querySelector<HTMLImageElement>('img[alt]')?.alt
        || '';
      const priceRoot = [...card.querySelectorAll<HTMLElement>('[aria-label]')]
        .find((element) => /^(?:US\s*)?(?:CA\$|AU\$|[$\u20ac\u00a3\u20b9])\s*\d/i.test(element.getAttribute('aria-label')?.trim() ?? ''));
      const originalPrice = card.querySelector<HTMLElement>('[style*="line-through"]')?.textContent?.trim() ?? null;
      const discount = [...card.querySelectorAll<HTMLElement>('span')]
        .map((element) => element.textContent?.trim() ?? '')
        .find((text) => /^-?\s*\d{1,3}%$/.test(text)) ?? null;
      const rating = [...card.querySelectorAll<HTMLElement>('span')]
        .find((element) => {
          const text = element.textContent?.trim() ?? '';
          const nearby = element.parentElement?.parentElement?.textContent ?? '';
          return /^[1-5](?:\.\d{1,2})?$/.test(text) && /sold/i.test(nearby);
        })?.textContent?.trim() ?? null;
      const orders = [...card.querySelectorAll<HTMLElement>('span')]
        .map((element) => element.textContent?.trim() ?? '')
        .find((text) => /sold/i.test(text)) ?? null;
      const image = [...card.querySelectorAll<HTMLImageElement>('img[src]')]
        .find((candidate) => candidate.alt?.trim() === title || /aliexpress-media|alicdn/i.test(candidate.src));
      return {
        href: card.href,
        title,
        priceText: priceRoot?.getAttribute('aria-label') ?? priceRoot?.textContent?.trim() ?? null,
        originalPriceText: originalPrice,
        discountText: discount,
        ratingText: rating,
        ordersText: orders,
        imageUrl: image?.src ?? null,
      };
    });
  });

  return rawProducts.flatMap((raw, index): ProductRecord[] => {
    const productId = raw.href.match(/\/item\/(\d+)\.html/i)?.[1] ?? null;
    const title = redactText(raw.title);
    const price = parseAliExpressMoney(raw.priceText);
    if (!productId || !title || price === null) return [];
    const candidateMrp = parseAliExpressMoney(raw.originalPriceText);
    const mrp = candidateMrp !== null && candidateMrp > price ? candidateMrp : null;
    return [withDefaults({
      source: 'aliexpress',
      searchQuery,
      position: ((pageNumber - 1) * Math.max(rawProducts.length, 1)) + index + 1,
      productId,
      title,
      brand: null,
      price,
      mrp,
      discountPercent: parseAliExpressDiscount(raw.discountText),
      currency: aliExpressCurrencyFrom(raw.priceText),
      packSize: null,
      category: null,
      rating: parseAliExpressRating(raw.ratingText),
      ratingCount: parseCompactCount(raw.ordersText),
      inStock: null,
      imageUrl: normalizeUrl(cleanText(raw.imageUrl)),
      productUrl: `https://www.aliexpress.com/item/${productId}.html`,
    })];
  });
}

export async function scrapeAliExpress(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
  let failedRequestCount = 0;
  let usableRequestCount = 0;
  const requests = context.input.searchQueries.flatMap((searchQuery) => Array.from(
    { length: context.input.maxPagesPerQuery },
    (_, index) => ({
      url: buildSearchUrl(searchQuery, index + 1),
      uniqueKey: `aliexpress-${searchQuery}-${index + 1}`,
      userData: { searchQuery, pageNumber: index + 1 },
    }),
  ));

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
    sessionPoolOptions: { maxPoolSize: 30, blockedStatusCodes: [], sessionOptions: { maxUsageCount: 10 } },
    browserPoolOptions: { useFingerprints: true },
    launchContext: {
      useChrome: true,
      launchOptions: { args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'] },
    },
    preNavigationHooks: [async ({ page }, gotoOptions) => {
      await blockHeavyBrowserResources(page);
      page.setDefaultTimeout(12_000);
      if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';
      await sleep(900 + Math.floor(Math.random() * 1200));
    }],
    requestHandler: async ({ page, request, session }) => {
      if (records.length >= context.maxResults) return;
      const { searchQuery, pageNumber } = request.userData as { searchQuery: string; pageNumber: number };
      await page.waitForSelector('a.search-card-item[href*="/item/"]', { timeout: 45_000 }).catch(() => null);
      if (await isAliExpressBlockedPage(page)) {
        session?.markBad();
        throw new Error(`AliExpress challenge page detected for ${request.url}`);
      }
      await scrollSearchResults(page);
      const products = await extractAliExpressProducts(page, searchQuery, pageNumber);
      if (products.length === 0) {
        const body = await page.locator('body').innerText().catch(() => '');
        if (isAliExpressExplicitEmptyText(body)) {
          usableRequestCount += 1;
          return;
        }
        session?.markBad();
        throw new Error(`AliExpress returned no usable product cards for "${searchQuery}" page ${pageNumber}.`);
      }
      appendProductCandidates(records, products, searchQuery, context.maxResults, context.maxResultsPerQuery);
      usableRequestCount += 1;
    },
    failedRequestHandler: async ({ request }, error) => {
      failedRequestCount += 1;
      console.warn(`AliExpress request failed: ${request.url} ${String(error)}`);
    },
  });

  await crawler.run(requests);
  if (records.length === 0 && failedRequestCount > 0 && usableRequestCount === 0) {
    throw new Error(`AliExpress failed for ${failedRequestCount} request(s) and returned no usable product data.`);
  }
  return records;
}
