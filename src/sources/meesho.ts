import { ProxyAgent } from 'undici';
import type { ProductRecord, SourceContext } from '../types.js';
import { HTTP_REQUEST_ATTEMPTS, proxyUrlForAttempt } from '../request-strategy.js';
import { absoluteUrl, appendProductCandidates, boolOrNull, cleanText, discountFromPrices, numberOrNull, redactText, sleep, withDefaults } from '../utils.js';

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

export function toMeeshoRecord(rawValue: unknown, query: string, position: number): ProductRecord | null {
  const raw = asObject(rawValue);
  const title = redactText(raw.name) ?? redactText(raw.hero_product_name) ?? redactText(raw.description);
  const catalogId = cleanText(raw.id ?? raw.catalogId ?? raw.catalog_id ?? raw.hero_pid ?? raw.product_id);
  if (!title || !catalogId) return null;
  const reviews = asObject(raw.catalog_reviews_summary);
  const price = numberOrNull(raw.min_catalog_price ?? raw.min_product_price ?? raw.price);
  const candidateMrp = numberOrNull(raw.original_price ?? raw.mrp ?? raw.max_catalog_price ?? raw.strikethrough_price);
  const mrp = candidateMrp !== null && price !== null && candidateMrp > price ? candidateMrp : null;
  const url = productUrl(raw, title);
  if (!url || price === null) return null;
  return withDefaults({
    source: 'meesho',
    searchQuery: query,
    position,
    productId: cleanText(raw.product_id) ?? catalogId,
    title,
    brand: redactText(raw.brand_name ?? raw.brand ?? raw.manufacturer),
    price,
    mrp,
    discountPercent: numberOrNull(raw.discount_percent ?? raw.discountPercent ?? raw.discount) ?? discountFromPrices(price, mrp),
    currency: 'INR',
    packSize: null,
    category: redactText(raw.sub_sub_category_name ?? raw.category_name ?? raw.category),
    rating: numberOrNull(reviews.average_rating ?? reviews.rating),
    ratingCount: numberOrNull(reviews.rating_count ?? reviews.ratingCount),
    inStock: boolOrNull(raw.in_stock),
    imageUrl: absoluteUrl(cleanText(raw.image), ORIGIN),
    productUrl: url,
  });
}

export type MeeshoPayloadClassification =
  | { kind: 'page'; catalogs: unknown[]; cursor: string | null; searchSessionId: string | null }
  | { kind: 'invalid'; reason: string };

export function classifyMeeshoPayload(value: unknown): MeeshoPayloadClassification {
  const root = asObject(value);
  const data = asObject(root.data);
  const catalogs = Array.isArray(root.catalogs) ? root.catalogs : Array.isArray(data.catalogs) ? data.catalogs : null;
  if (!catalogs) return { kind: 'invalid', reason: 'Meesho response did not contain a catalogs array' };
  return {
    kind: 'page',
    catalogs,
    cursor: cleanText(root.cursor ?? data.cursor),
    searchSessionId: cleanText(root.search_session_id ?? data.search_session_id),
  };
}

async function fetchPage(context: SourceContext, query: string, page: number, cursor: string | null, searchSessionId: string | null): Promise<any> {
  let lastError = new Error(`Meesho request failed for query ${query}`);
  for (let attempt = 1; attempt <= HTTP_REQUEST_ATTEMPTS; attempt += 1) {
    const proxyUrl = await proxyUrlForAttempt(context.proxyConfiguration, `meesho_${page}`, attempt);
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
        signal: AbortSignal.timeout(45_000),
        ...(dispatcher ? { dispatcher } : {}),
      } as any);
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
      try {
        return JSON.parse(body);
      } catch {
        throw new Error(`Meesho returned non-JSON content: ${body.slice(0, 120)}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= HTTP_REQUEST_ATTEMPTS) throw error;
      await sleep(900 * attempt);
    } finally {
      if (dispatcher) await dispatcher.close().catch(() => undefined);
    }
  }
  throw lastError;
}

export async function scrapeMeesho(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
  for (const query of context.input.searchQueries) {
    let cursor: string | null = null;
    let searchSessionId: string | null = null;
    let querySaved = 0;
    const queryLimit = context.maxResultsPerQuery ?? context.maxResults;
    for (let page = 1; page <= context.input.maxPagesPerQuery && records.length < context.maxResults; page += 1) {
      const response = await fetchPage(context, query, page, cursor, searchSessionId);
      const payload = classifyMeeshoPayload(response);
      if (payload.kind === 'invalid') throw new Error(payload.reason);
      const { catalogs } = payload;
      cursor = payload.cursor;
      searchSessionId = payload.searchSessionId ?? searchSessionId;
      if (catalogs.length === 0) break;
      const mapped = catalogs.map((catalog: unknown, index: number) => toMeeshoRecord(catalog, query, (page - 1) * PAGE_SIZE + index + 1))
        .filter((item: ProductRecord | null): item is ProductRecord => item !== null);
      if (mapped.length === 0) throw new Error('Meesho returned catalog rows but none had a valid title, price, and product URL.');
      querySaved += appendProductCandidates(records, mapped, query, context.maxResults, queryLimit);
      if (querySaved >= queryLimit) break;
      if (!cursor) break;
      await sleep(650 + Math.floor(Math.random() * 700));
    }
    if (records.length >= context.maxResults) break;
  }
  return records;
}
