import { ProxyAgent } from 'undici';
import type { ProductRecord, SourceContext } from '../types.js';
import { absoluteUrl, appendProductCandidates, cleanText, discountFromPrices, numberOrNull, redactText, sleep, uniqueStrings, withDefaults } from '../utils.js';

const ORIGIN = 'https://www.myntra.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';

interface MyntraProduct {
  productId?: number | string;
  brand?: string;
  productName?: string;
  product?: string;
  category?: string;
  price?: number;
  mrp?: number;
  discountDisplayLabel?: string;
  rating?: number;
  ratingCount?: number;
  sizes?: string;
  searchImage?: string;
  landingPageUrl?: string;
  images?: Array<{ view?: string; src?: string }>;
  inventoryInfo?: Array<{ available?: boolean }>;
}

function slugifyQuery(query: string): string {
  return query.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || encodeURIComponent(query);
}

function buildSearchUrl(query: string, page: number): string {
  const url = new URL(`${ORIGIN}/${slugifyQuery(query)}`);
  url.searchParams.set('rawQuery', query);
  if (page > 1) url.searchParams.set('p', String(page));
  return url.toString();
}

export function extractMyxData(html: string): unknown | null {
  const assignment = /window\.__myx\s*=\s*/g.exec(html);
  if (!assignment) return null;
  const bodyStart = assignment.index + assignment[0].length;
  const end = html.indexOf('</script>', bodyStart);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(bodyStart, end).trim().replace(/;$/, ''));
  } catch {
    return null;
  }
}

export type MyntraPayloadClassification =
  | { kind: 'products'; products: MyntraProduct[] }
  | { kind: 'empty'; products: [] }
  | { kind: 'invalid'; products: []; reason: string };

export function classifyMyxPayload(data: unknown): MyntraPayloadClassification {
  if (!data || typeof data !== 'object') {
    return { kind: 'invalid', products: [], reason: 'window.__myx was missing or invalid JSON' };
  }
  const root = data as { searchData?: { results?: { products?: unknown } } };
  const products = root.searchData?.results?.products;
  if (!Array.isArray(products)) {
    return { kind: 'invalid', products: [], reason: 'window.__myx did not contain searchData.results.products' };
  }
  if (products.length === 0) return { kind: 'empty', products: [] };
  return { kind: 'products', products: products as MyntraProduct[] };
}

function bestImage(product: MyntraProduct): string | null {
  const search = absoluteUrl(cleanText(product.searchImage), ORIGIN);
  if (search) return search;
  const image = product.images?.find((item) => item.view === 'search' && item.src)
    ?? product.images?.find((item) => item.view === 'default' && item.src)
    ?? product.images?.find((item) => item.src);
  return absoluteUrl(cleanText(image?.src), ORIGIN);
}

function productUrl(product: MyntraProduct): string | null {
  const url = absoluteUrl(cleanText(product.landingPageUrl), ORIGIN);
  if (!url) return null;
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return hostname === 'myntra.com' ? url : null;
}

export function toMyntraRecord(product: MyntraProduct, query: string, position: number): ProductRecord | null {
  const title = redactText(product.productName) ?? redactText(product.product);
  const url = productUrl(product);
  if (!title || !url) return null;
  const price = numberOrNull(product.price);
  if (price === null) return null;
  const candidateMrp = numberOrNull(product.mrp);
  const mrp = candidateMrp !== null && candidateMrp >= price ? candidateMrp : null;
  const discountLabel = cleanText(product.discountDisplayLabel);
  const discountPercent = discountFromPrices(price, mrp) ?? numberOrNull(discountLabel?.match(/(\d+)\s*%/)?.[1]);
  const sizes = uniqueStrings(cleanText(product.sizes)?.split(',') ?? []);
  const availability = product.inventoryInfo
    ?.map((item) => item.available)
    .filter((value): value is boolean => typeof value === 'boolean');

  return withDefaults({
    source: 'myntra',
    searchQuery: query,
    position,
    productId: cleanText(product.productId),
    title,
    brand: redactText(product.brand),
    price,
    mrp,
    discountPercent,
    currency: 'INR',
    packSize: sizes.length ? sizes.join(', ') : null,
    category: redactText(product.category),
    rating: numberOrNull(product.rating),
    ratingCount: numberOrNull(product.ratingCount),
    inStock: availability?.length ? availability.some(Boolean) : null,
    imageUrl: bestImage(product),
    productUrl: url,
  });
}

async function fetchHtml(url: string, context: SourceContext): Promise<string> {
  let lastError = new Error(`Myntra request failed for ${url}`);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const proxyUrl = await context.proxyConfiguration?.newUrl(`myntra_${attempt}`);
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-IN,en;q=0.9',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'user-agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(45_000),
        ...(dispatcher ? { dispatcher } : {}),
      } as any);
      if ([401, 403, 429, 529].includes(response.status)) {
        lastError = new Error(`Myntra was blocked or rate-limited with HTTP ${response.status}`);
        await sleep(900 * attempt);
        continue;
      }
      if (response.status >= 500) {
        lastError = new Error(`Myntra returned transient HTTP ${response.status}`);
        await sleep(900 * attempt);
        continue;
      }
      if (!response.ok) throw new Error(`Myntra returned HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await sleep(800 * attempt);
    } finally {
      if (dispatcher) await dispatcher.close().catch(() => undefined);
    }
  }
  throw lastError;
}

export async function scrapeMyntra(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
  for (const query of context.input.searchQueries) {
    let position = 1;
    let querySaved = 0;
    const queryLimit = context.maxResultsPerQuery ?? context.maxResults;
    for (let page = 1; page <= context.input.maxPagesPerQuery && records.length < context.maxResults; page += 1) {
      const html = await fetchHtml(buildSearchUrl(query, page), context);
      const payload = classifyMyxPayload(extractMyxData(html));
      if (payload.kind === 'invalid') throw new Error(`Myntra payload invalid: ${payload.reason}`);
      if (payload.kind === 'empty') break;
      const products = payload.products;
      const mapped = products.map((product, index) => toMyntraRecord(product, query, position + index)).filter((item): item is ProductRecord => item !== null);
      if (mapped.length === 0) throw new Error('Myntra returned product rows but none had a valid title and Myntra URL.');
      querySaved += appendProductCandidates(records, mapped, query, context.maxResults, queryLimit);
      position += products.length;
      if (querySaved >= queryLimit) break;
      await sleep(700 + Math.floor(Math.random() * 700));
    }
    if (records.length >= context.maxResults) break;
  }
  return records;
}
