import { gotScraping } from 'got-scraping';
import type { ProductRecord, SourceContext } from '../types.js';
import { HTTP_REQUEST_ATTEMPTS, proxyUrlForAttempt } from '../request-strategy.js';
import { absoluteUrl, appendProductCandidates, cleanText, discountFromPrices, integerOrNull, numberOrNull, redactText, sleep, withDefaults } from '../utils.js';

const ORIGIN = 'https://www.bigbasket.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36';

function cookieHeader(setCookie: string[] | string | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(';')[0]).filter(Boolean).join('; ');
}

export function productsFromBigBasketPayload(data: Record<string, any>, query: string, page: number): { products: ProductRecord[]; pages: number } {
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    throw new Error(`BigBasket listing API error: ${cleanText(data.errors[0]?.msg) ?? 'unknown error'}`);
  }
  const tabs = Array.isArray(data.tabs) ? data.tabs : null;
  const productInfo = tabs?.[0]?.product_info;
  if (!productInfo || !Array.isArray(productInfo.products)) {
    throw new Error('BigBasket listing API returned an unexpected payload shape.');
  }
  const rawProducts: any[] = productInfo.products;
  const products = rawProducts.flatMap((product, index): ProductRecord[] => {
    const price = numberOrNull(product.pricing?.discount?.prim_price?.sp);
    const candidateMrp = numberOrNull(product.pricing?.discount?.mrp);
    const productId = cleanText(product.id);
    const title = redactText(product.desc);
    const rawUrl = cleanText(product.absolute_url);
    if (price === null || !productId || !title || !rawUrl) return [];
    const mrp = candidateMrp !== null && candidateMrp >= price ? candidateMrp : null;
    const inStock = product.availability?.avail_status === '001' && product.availability?.not_for_sale !== true;
    return [withDefaults({
      source: 'bigbasket',
      searchQuery: query,
      position: ((page - 1) * Math.max(rawProducts.length, 1)) + index + 1,
      productId,
      title,
      brand: redactText(product.brand?.name),
      price,
      mrp,
      discountPercent: discountFromPrices(price, mrp),
      currency: 'INR',
      packSize: redactText(product.w),
      category: redactText(product.category?.tlc_name ?? product.category?.llc_name ?? product.category?.mlc_name),
      rating: numberOrNull(product.rating_info?.avg_rating),
      ratingCount: integerOrNull(product.rating_info?.rating_count),
      inStock,
      imageUrl: absoluteUrl(cleanText(product.images?.[0]?.l ?? product.images?.[0]?.m ?? product.images?.[0]?.s), ORIGIN),
      productUrl: absoluteUrl(rawUrl, ORIGIN),
    })];
  });

  return { products, pages: integerOrNull(productInfo.number_of_pages) ?? page };
}

async function fetchPage(query: string, page: number, proxyUrl?: string): Promise<{ products: ProductRecord[]; pages: number }> {
  const landingUrl = `${ORIGIN}/ps/?q=${encodeURIComponent(query)}`;
  const headers = { 'user-agent': USER_AGENT, 'accept-language': 'en-IN,en;q=0.9' };
  const landing = await gotScraping({
    url: landingUrl,
    proxyUrl,
    headers: { ...headers, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    responseType: 'text',
    throwHttpErrors: false,
    timeout: { request: 60_000 },
  });
  if (landing.statusCode >= 400) throw new Error(`BigBasket landing HTTP ${landing.statusCode}`);

  const endpoint = new URL('/listing-svc/v2/products', ORIGIN);
  endpoint.searchParams.set('type', 'ps');
  endpoint.searchParams.set('slug', query);
  endpoint.searchParams.set('page', String(page));

  const response = await gotScraping({
    url: endpoint,
    proxyUrl,
    headers: {
      ...headers,
      accept: 'application/json, text/plain, */*',
      referer: landingUrl,
      cookie: cookieHeader(landing.headers['set-cookie']),
      'osmos-enabled': 'true',
      'x-channel': 'BB-WEB',
      'x-caller': 'UIKIRK',
      'x-entry-context': 'bb-b2c',
      'x-entry-context-id': '100',
      'common-client-static-version': '101',
    },
    responseType: 'text',
    throwHttpErrors: false,
    timeout: { request: 60_000 },
  });
  if (response.statusCode >= 400) throw new Error(`BigBasket API HTTP ${response.statusCode}`);

  const data = JSON.parse(response.body) as Record<string, any>;
  return productsFromBigBasketPayload(data, query, page);
}

export async function scrapeBigBasket(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
  for (const [queryIndex, query] of context.input.searchQueries.entries()) {
    let querySaved = 0;
    const queryLimit = context.maxResultsPerQuery ?? context.maxResults;
    for (let page = 1; page <= context.input.maxPagesPerQuery && records.length < context.maxResults; page += 1) {
      let result: Awaited<ReturnType<typeof fetchPage>> | null = null;
      let lastError: unknown;
      for (let attempt = 1; attempt <= HTTP_REQUEST_ATTEMPTS; attempt += 1) {
        try {
          const proxyUrl = await proxyUrlForAttempt(
            context.proxyConfiguration,
            `bigbasket_${queryIndex}_${page}`,
            attempt,
          );
          result = await fetchPage(query, page, proxyUrl);
          break;
        } catch (error) {
          lastError = error;
          await sleep(900 * attempt);
        }
      }
      if (!result) throw lastError instanceof Error ? lastError : new Error(String(lastError));
      if (result.products.length === 0) break;
      querySaved += appendProductCandidates(records, result.products, query, context.maxResults, queryLimit);
      if (querySaved >= queryLimit) break;
      if (page >= result.pages) break;
      await sleep(500 + Math.floor(Math.random() * 800));
    }
    if (records.length >= context.maxResults) break;
  }
  return records;
}
