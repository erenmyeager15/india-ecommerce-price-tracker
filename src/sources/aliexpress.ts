import type { Page } from 'playwright';
import { PlaywrightCrawler } from 'crawlee';
import type { ProductRecord, SourceContext } from '../types.js';
import { cleanText, numberOrNull, parseCompactCount, redactText, sleep, withDefaults } from '../utils.js';

function buildSearchUrl(query: string, pageNumber: number): string {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'products';
  const params = new URLSearchParams({ SearchText: query });
  if (pageNumber > 1) params.set('page', String(pageNumber));
  return `https://www.aliexpress.com/w/wholesale-${slug}.html?${params.toString()}`;
}

function parseMoney(value: string | null): number | null {
  if (!value) return null;
  const numeric = value.replace(/\u00a0/g, ' ').match(/(?:US\s*)?(?:CA\$|AU\$|[$€£₹])\s*(\d[\d,]*(?:\.\d+)?)/i)?.[1]
    ?? value.match(/\d[\d,]*(?:\.\d+)?/)?.[0];
  return numberOrNull(numeric);
}

function parseDiscount(value: string | null): number | null {
  return numberOrNull(value?.match(/(\d{1,3})\s*%/)?.[1]);
}

function currencyFrom(value: string | null): string {
  if (!value) return 'USD';
  if (value.includes('€')) return 'EUR';
  if (value.includes('£')) return 'GBP';
  if (value.includes('₹')) return 'INR';
  if (value.includes('CA$')) return 'CAD';
  if (value.includes('AU$')) return 'AUD';
  return 'USD';
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith('//') ? `https:${value}` : value;
}

async function scrollSearchResults(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 1.8, 1200)));
    await page.waitForTimeout(850 + Math.floor(Math.random() * 650));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function isBlockedPage(page: Page): Promise<boolean> {
  const state = await page.evaluate(() => ({
    title: document.title,
    body: document.body?.innerText?.slice(0, 15_000) ?? '',
  }));
  return /captcha|robot|security verification|unusual traffic|access denied|punish/i.test(`${state.title}\n${state.body}`);
}

async function extractProducts(page: Page, searchQuery: string, pageNumber: number): Promise<ProductRecord[]> {
  const rawProducts = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a.search-card-item[href*="/item/"]')];
    return anchors.map((card) => {
      const title = card.querySelector('h3')?.textContent?.trim()
        || card.querySelector<HTMLElement>('[role="heading"]')?.getAttribute('aria-label')
        || card.querySelector<HTMLImageElement>('img[alt]')?.alt
        || '';
      const priceRoot = [...card.querySelectorAll<HTMLElement>('[aria-label]')]
        .find((element) => /^(?:US\s*)?(?:CA\$|AU\$|[$€£₹])\s*\d/i.test(element.getAttribute('aria-label')?.trim() ?? ''));
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
    const price = parseMoney(raw.priceText);
    if (!productId || !title || price === null) return [];
    return [withDefaults({
      source: 'aliexpress',
      searchQuery,
      position: ((pageNumber - 1) * Math.max(rawProducts.length, 1)) + index + 1,
      productId,
      title,
      brand: null,
      price,
      mrp: parseMoney(raw.originalPriceText),
      discountPercent: parseDiscount(raw.discountText),
      currency: currencyFrom(raw.priceText),
      packSize: null,
      category: null,
      rating: numberOrNull(raw.ratingText),
      ratingCount: parseCompactCount(raw.ordersText),
      inStock: null,
      imageUrl: normalizeUrl(cleanText(raw.imageUrl)),
      productUrl: `https://www.aliexpress.com/item/${productId}.html`,
    })];
  });
}

export async function scrapeAliExpress(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
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
    maxRequestRetries: 2,
    retryOnBlocked: true,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 180,
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
      page.setDefaultTimeout(12_000);
      if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';
      await sleep(900 + Math.floor(Math.random() * 1200));
    }],
    requestHandler: async ({ page, request, session }) => {
      if (records.length >= context.maxResults) return;
      const { searchQuery, pageNumber } = request.userData as { searchQuery: string; pageNumber: number };
      await page.waitForSelector('a.search-card-item[href*="/item/"]', { timeout: 60_000 }).catch(() => null);
      if (await isBlockedPage(page)) {
        session?.markBad();
        throw new Error(`AliExpress challenge page detected for ${request.url}`);
      }
      await scrollSearchResults(page);
      const products = await extractProducts(page, searchQuery, pageNumber);
      records.push(...products.slice(0, context.maxResults - records.length));
    },
    failedRequestHandler: async ({ request }, error) => {
      console.warn(`AliExpress request failed: ${request.url} ${String(error)}`);
    },
  });

  await crawler.run(requests);
  return records;
}
