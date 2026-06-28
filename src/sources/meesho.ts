import { ProxyAgent } from 'undici';
import type { ProductRecord, SourceContext } from '../types.js';
import { absoluteUrl, boolOrNull, cleanText, numberOrNull, redactText, sleep, withDefaults } from '../utils.js';

const ORIGIN = 'https://www.meesho.com';
const SEARCH_API = `${ORIGIN}/api/v1/products/search`;
const PAGE_SIZE = 20;

function buildSearchUrl(query: string): string {
  return `${ORIGIN}/search?${new URLSearchParams({ q: query }).toString()}`;
}

function buildPayload(query: string, page: number, cursor: string | null, searchSessionId: string | null): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    query,
    type: 'text_search',
    page,
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
    cursor,
    isDevicePhone: false,
  };
  if (searchSessionId) payload.search_session_id = searchSessionId;
  return payload;
}

function asObject(value: unknown): Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, any> : {};
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product';
}

function productUrl(raw: Record<string, any>, title: string): string | null {
  const productId = cleanText(raw.product_id);
  if (!productId) return null;
  const rawSlug = cleanText(raw.original_slug) ?? cleanText(raw.slug) ?? title;
  return `${ORIGIN}/${slugify(rawSlug)}/p/${encodeURIComponent(productId)}`;
}

function toRecord(rawValue: unknown, query: string, position: number): ProductRecord | null {
  const raw = asObject(rawValue);
  const title = redactText(raw.name) ?? redactText(raw.hero_product_name) ?? redactText(raw.description);
  const catalogId = cleanText(raw.id ?? raw.catalogId ?? raw.catalog_id ?? raw.hero_pid ?? raw.product_id);
  if (!title || !catalogId) return null;
  const reviews = asObject(raw.catalog_reviews_summary);
  const shipping = asObject(raw.shipping);
  return withDefaults({
    source: 'meesho',
    searchQuery: query,
    position,
    productId: cleanText(raw.product_id) ?? catalogId,
    title,
    brand: null,
    price: numberOrNull(raw.min_catalog_price ?? raw.min_product_price),
    mrp: null,
    discountPercent: null,
    currency: 'INR',
    packSize: null,
    category: redactText(raw.sub_sub_category_name),
    rating: numberOrNull(reviews.average_rating ?? reviews.rating),
    ratingCount: numberOrNull(reviews.rating_count ?? reviews.ratingCount),
    inStock: boolOrNull(raw.in_stock),
    imageUrl: absoluteUrl(cleanText(raw.image), ORIGIN),
    productUrl: productUrl(raw, title),
  });
}

async function fetchPage(context: SourceContext, query: string, page: number, cursor: string | null, searchSessionId: string | null): Promise<any> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const proxyUrl = await context.proxyConfiguration?.newUrl(`meesho_${page}_${attempt}`);
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    try {
      const response = await fetch(SEARCH_API, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'en-IN,en;q=0.9',
          'content-type': 'application/json',
          origin: ORIGIN,
          referer: buildSearchUrl(query),
          'meesho-iso-country-code': 'IN',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        },
        body: JSON.stringify(buildPayload(query, page, cursor, searchSessionId)),
        ...(dispatcher ? { dispatcher } : {}),
      } as any);
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
      return JSON.parse(body);
    } catch (error) {
      if (attempt >= 4) throw error;
      await sleep(900 * attempt);
    }
  }
}

export async function scrapeMeesho(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
  for (const query of context.input.searchQueries) {
    let cursor: string | null = null;
    let searchSessionId: string | null = null;
    for (let page = 1; page <= context.input.maxPagesPerQuery && records.length < context.maxResults; page += 1) {
      const response = await fetchPage(context, query, page, cursor, searchSessionId);
      const catalogs = Array.isArray(response.catalogs) ? response.catalogs : [];
      cursor = response.cursor ?? null;
      searchSessionId = response.search_session_id ?? searchSessionId;
      if (catalogs.length === 0) break;
      const mapped = catalogs.map((catalog: unknown, index: number) => toRecord(catalog, query, (page - 1) * PAGE_SIZE + index + 1))
        .filter((item: ProductRecord | null): item is ProductRecord => item !== null);
      records.push(...mapped.slice(0, context.maxResults - records.length));
      if (!cursor) break;
      await sleep(650 + Math.floor(Math.random() * 700));
    }
    if (records.length >= context.maxResults) break;
  }
  return records;
}
