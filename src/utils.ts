import type { MatchConfidence, NormalizedInput, ProductRecord } from './types.js';

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\w)(?:\+?\d[\d\s().-]*){9,}(?!\w)/g;
const EMPTY_TEXT_PATTERN = /^(?:undefined|null|nan|n\/a|na)$/i;
const PRODUCT_HOSTS: Record<string, string> = {
  flipkart: 'flipkart.com',
  myntra: 'myntra.com',
  bigbasket: 'bigbasket.com',
  blinkit: 'blinkit.com',
  jiomart: 'jiomart.com',
  meesho: 'meesho.com',
  aliexpress: 'aliexpress.com',
};
type ProductRecordInput = Partial<Record<keyof ProductRecord, unknown>>;

export const OUTPUT_FIELDS = [
  'source',
  'searchQuery',
  'targetProduct',
  'matchConfidence',
  'matchScore',
  'matchReason',
  'position',
  'productId',
  'title',
  'brand',
  'price',
  'mrp',
  'discountPercent',
  'currency',
  'packSize',
  'category',
  'rating',
  'ratingCount',
  'inStock',
  'productUrl',
  'imageUrl',
  'scrapedAt',
] as const;

export function cleanText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text || EMPTY_TEXT_PATTERN.test(text) || /^proxied content$/i.test(text)) return null;
  return text;
}

export function redactText(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  return text.replace(EMAIL_PATTERN, '[redacted]').replace(PHONE_PATTERN, '[redacted]').replace(/\s+/g, ' ').trim();
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = cleanText(value);
  const numeric = text?.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0];
  if (!numeric || numeric === '-' || numeric === '.') return null;
  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

export function integerOrNull(value: unknown): number | null {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number);
}

export function boolOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
}

export function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const text = cleanText(value);
    if (text) seen.add(text);
  }
  return [...seen];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function appendProductCandidates(
  records: ProductRecord[],
  candidates: ProductRecord[],
  searchQuery: string,
  maxResults: number,
  maxResultsPerQuery = maxResults,
): number {
  const queryCount = records.filter((record) => record.searchQuery === searchQuery).length;
  const capacity = Math.max(0, Math.min(maxResults - records.length, maxResultsPerQuery - queryCount));
  const selected = candidates.slice(0, capacity);
  records.push(...selected);
  return selected.length;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'product';
}

export function absoluteUrl(value: string | null, origin: string): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const candidate = text.startsWith('//')
    ? `https:${text}`
    : /^https?:\/\//i.test(text)
      ? text
      : `${origin}${text.startsWith('/') ? '' : '/'}${text}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

export function discountFromPrices(price: number | null, mrp: number | null): number | null {
  if (price === null || mrp === null || mrp <= price || mrp <= 0) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}

function textOrFallback(value: unknown, fallback: string): string {
  return redactText(value) ?? fallback;
}

function integerPosition(value: unknown): number | null {
  const parsed = integerOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function ratingOrNull(value: unknown, ratingCount: number | null): number | null {
  const rating = numberOrNull(value);
  if (rating === null) return null;
  if (rating === 0 && (ratingCount === null || ratingCount === 0)) return null;
  return Math.round(rating * 10) / 10;
}

function isoTimestamp(value: unknown): string {
  const text = cleanText(value);
  if (text) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function validAbsoluteOutputUrl(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const candidate = text.startsWith('//') ? `https:${text}` : text;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeProductRecord(record: ProductRecordInput): ProductRecord {
  const ratingCount = integerOrNull(record.ratingCount);
  const matchConfidence = cleanText(record.matchConfidence) as MatchConfidence | null;
  return {
    source: textOrFallback(record.source, 'N/A'),
    searchQuery: textOrFallback(record.searchQuery, 'N/A'),
    targetProduct: textOrFallback(record.targetProduct, textOrFallback(record.searchQuery, 'N/A')),
    matchConfidence: matchConfidence && ['exact', 'high', 'likely', 'needs_review'].includes(matchConfidence)
      ? matchConfidence
      : 'needs_review',
    matchScore: Math.min(Math.max(integerOrNull(record.matchScore) ?? 0, 0), 100),
    matchReason: textOrFallback(record.matchReason, 'Candidate not scored yet.'),
    position: integerPosition(record.position),
    productId: cleanText(record.productId),
    title: textOrFallback(record.title, 'N/A'),
    brand: textOrFallback(record.brand, 'N/A'),
    price: numberOrNull(record.price),
    mrp: numberOrNull(record.mrp),
    discountPercent: numberOrNull(record.discountPercent),
    currency: textOrFallback(record.currency, 'INR').toUpperCase(),
    packSize: textOrFallback(record.packSize, 'N/A'),
    category: textOrFallback(record.category, 'N/A'),
    rating: ratingOrNull(record.rating, ratingCount),
    ratingCount,
    inStock: boolOrNull(record.inStock),
    productUrl: validAbsoluteOutputUrl(record.productUrl),
    imageUrl: validAbsoluteOutputUrl(record.imageUrl),
    scrapedAt: isoTimestamp(record.scrapedAt),
  };
}

export function withDefaults(record: ProductRecordInput & { source: unknown }): ProductRecord {
  return normalizeProductRecord({
    ...record,
    currency: record.currency ?? 'INR',
    scrapedAt: record.scrapedAt ?? new Date().toISOString(),
  });
}

export function validateProductRecord(record: ProductRecord): string[] {
  const errors: string[] = [];
  const keys = Object.keys(record);
  if (keys.join('|') !== OUTPUT_FIELDS.join('|')) {
    errors.push(`Unexpected output field order: ${keys.join(', ')}`);
  }
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) errors.push(`${key} is undefined`);
    if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`${key} is not a finite number`);
  }
  if (!record.source || record.source === 'N/A') errors.push('source is required');
  if (!PRODUCT_HOSTS[record.source]) errors.push('source is unsupported');
  if (!record.searchQuery || record.searchQuery === 'N/A') errors.push('searchQuery is required');
  if (!record.targetProduct || record.targetProduct === 'N/A') errors.push('targetProduct is required');
  if (!['exact', 'high', 'likely', 'needs_review'].includes(record.matchConfidence)) errors.push('matchConfidence is invalid');
  if (record.matchScore < 0 || record.matchScore > 100) errors.push('matchScore must be between 0 and 100');
  if (!record.title || record.title === 'N/A') errors.push('title is required');
  if (record.price === null || record.price < 0) errors.push('price must be a non-negative number');
  if (record.mrp !== null && record.mrp < 0) errors.push('mrp must be non-negative or null');
  if (record.mrp !== null && record.price !== null && record.mrp < record.price) errors.push('mrp must not be lower than price');
  if (record.discountPercent !== null && (record.discountPercent < 0 || record.discountPercent > 100)) {
    errors.push('discountPercent must be between 0 and 100 or null');
  }
  if (record.rating !== null && (record.rating < 0 || record.rating > 5)) errors.push('rating must be between 0 and 5 or null');
  if (record.ratingCount !== null && (!Number.isInteger(record.ratingCount) || record.ratingCount < 0)) {
    errors.push('ratingCount must be a non-negative integer or null');
  }
  if (!/^[A-Z]{3}$/.test(record.currency)) errors.push('currency must be a three-letter uppercase code');
  if (Number.isNaN(Date.parse(record.scrapedAt))) errors.push('scrapedAt must be a valid timestamp');
  for (const key of ['productUrl', 'imageUrl'] as const) {
    const value = record[key];
    if (value !== null && !/^https?:\/\//i.test(value)) errors.push(`${key} must be an absolute URL or null`);
  }
  if (record.productUrl === null) {
    errors.push('productUrl is required');
  } else if (PRODUCT_HOSTS[record.source]) {
    try {
      const hostname = new URL(record.productUrl).hostname.toLowerCase().replace(/^www\./, '');
      const expected = PRODUCT_HOSTS[record.source];
      if (hostname !== expected && !hostname.endsWith(`.${expected}`)) errors.push(`productUrl must use ${expected}`);
    } catch {
      errors.push('productUrl must be a valid absolute URL');
    }
  }
  return errors;
}

export function shouldKeepProduct(record: ProductRecord, input: NormalizedInput): boolean {
  if (input.brands.size > 0) {
    const brand = record.brand.toLowerCase();
    if (brand === 'n/a' || !input.brands.has(brand)) return false;
  }
  if (input.inStockOnly && record.inStock !== true) return false;
  if (record.price === null) return false;
  if (record.price < input.minPrice) return false;
  if (record.price > input.maxPrice) return false;
  return true;
}

export function hasForbiddenField(record: ProductRecord): boolean {
  return Object.keys(record).some((key) => /(seller|merchant|reviewer|userName|email|phone|contact)/i.test(key));
}

export function parseCompactCount(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/,/g, '').trim();
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (/crore|\bcr\b/.test(normalized)) return Math.round(parsed * 10_000_000);
  if (/lakh|lac|\d(?:\.\d+)?\s*l\b/.test(normalized)) return Math.round(parsed * 100_000);
  if (/\d(?:\.\d+)?\s*k\b|thousand/.test(normalized)) return Math.round(parsed * 1_000);
  if (/\d(?:\.\d+)?\s*m\b|million/.test(normalized)) return Math.round(parsed * 1_000_000);
  return Math.round(parsed);
}

export function summarizeProducts(records: ProductRecord[], input: NormalizedInput): Record<string, unknown> {
  const prices = records.map((record) => record.price).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const bySource: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  for (const record of records) {
    bySource[record.source] = (bySource[record.source] ?? 0) + 1;
    byConfidence[record.matchConfidence] = (byConfidence[record.matchConfidence] ?? 0) + 1;
  }
  const cheapest = records
    .filter((record) => record.price !== null)
    .sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY))[0];
  const highestRated = records
    .filter((record) => record.rating !== null)
    .sort((a, b) => {
      const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
      return ratingDiff !== 0 ? ratingDiff : (b.ratingCount ?? 0) - (a.ratingCount ?? 0);
    })[0];

  return {
    totalResults: records.length,
    totalSources: Object.keys(bySource).length,
    searchQuery: input.searchQueries.join(', '),
    sourcesIncluded: Object.keys(bySource),
    resultsPerSource: bySource,
    resultsByMatchConfidence: byConfidence,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    averagePrice: prices.length ? Math.round((prices.reduce((sum, price) => sum + price, 0) / prices.length) * 100) / 100 : null,
    cheapestItem: cheapest ? { title: cheapest.title, source: cheapest.source, price: cheapest.price } : null,
    highestRatedItem: highestRated ? {
      title: highestRated.title,
      source: highestRated.source,
      rating: highestRated.rating,
      ratingCount: highestRated.ratingCount,
    } : null,
    missingPriceCount: records.filter((record) => record.price === null).length,
    missingRatingCount: records.filter((record) => record.rating === null).length,
    finishedAt: new Date().toISOString(),
  };
}
