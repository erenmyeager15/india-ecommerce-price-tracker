import type { NormalizedInput, ProductRecord } from './types.js';

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\w)(?:\+?\d[\d\s().-]*){9,}(?!\w)/g;

export function cleanText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function redactText(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  return text.replace(EMAIL_PATTERN, '[redacted]').replace(PHONE_PATTERN, '[redacted]').replace(/\s+/g, ' ').trim();
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = cleanText(value)?.replace(/[,₹$€£\s]/g, '');
  if (!text || text === '-' || text === '.') return null;
  const parsed = Number.parseFloat(text);
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

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'product';
}

export function absoluteUrl(value: string | null, origin: string): string | null {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value.replace(/^http:\/\//i, 'https://');
  return `${origin}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function discountFromPrices(price: number | null, mrp: number | null): number | null {
  if (price === null || mrp === null || mrp <= price || mrp <= 0) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}

export function withDefaults(record: Omit<ProductRecord, 'scrapedAt'> & { scrapedAt?: string }): ProductRecord {
  return {
    ...record,
    title: redactText(record.title),
    brand: redactText(record.brand),
    category: redactText(record.category),
    packSize: redactText(record.packSize),
    currency: record.currency ?? 'INR',
    scrapedAt: record.scrapedAt ?? new Date().toISOString(),
  };
}

export function shouldKeepProduct(record: ProductRecord, input: NormalizedInput): boolean {
  if (input.brands.size > 0) {
    const brand = record.brand?.toLowerCase();
    if (!brand || !input.brands.has(brand)) return false;
  }
  if (input.inStockOnly && record.inStock !== true) return false;
  if (record.price === null) return input.minPrice <= 0 && input.maxPrice >= 1_000_000;
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
  if (/lakh|lac|\bl\b/.test(normalized)) return Math.round(parsed * 100_000);
  if (/\bk\b|thousand/.test(normalized)) return Math.round(parsed * 1_000);
  if (/\bm\b|million/.test(normalized)) return Math.round(parsed * 1_000_000);
  return Math.round(parsed);
}

