import { ProxyAgent } from 'undici';
import type { ProductRecord, SourceContext } from '../types.js';
import { absoluteUrl, cleanText, discountFromPrices, numberOrNull, redactText, sleep, uniqueStrings, withDefaults } from '../utils.js';

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

function extractMyxData(html: string): unknown | null {
  const marker = 'window.__myx = ';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const bodyStart = start + marker.length;
  const end = html.indexOf('</script>', bodyStart);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(bodyStart, end).trim().replace(/;$/, ''));
  } catch {
    return null;
  }
}

function productsFromMyx(data: unknown): MyntraProduct[] {
  if (!data || typeof data !== 'object') return [];
  const root = data as { searchData?: { results?: { products?: unknown } } };
  return Array.isArray(root.searchData?.results?.products) ? root.searchData.results.products as MyntraProduct[] : [];
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
  return absoluteUrl(cleanText(product.landingPageUrl), ORIGIN);
}

function toRecord(product: MyntraProduct, query: string, position: number): ProductRecord | null {
  const title = redactText(product.productName) ?? redactText(product.product);
  const url = productUrl(product);
  if (!title || !url) return null;
  const price = numberOrNull(product.price);
  const mrp = numberOrNull(product.mrp);
  const discountLabel = cleanText(product.discountDisplayLabel);
  const discountPercent = discountFromPrices(price, mrp) ?? numberOrNull(discountLabel?.match(/(\d+)\s*%/)?.[1]);
  const sizes = uniqueStrings(cleanText(product.sizes)?.split(',') ?? []);

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
    inStock: null,
    imageUrl: bestImage(product),
    productUrl: url,
    city: null,
  });
}

async function fetchHtml(url: string, context: SourceContext): Promise<string | null> {
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
        ...(dispatcher ? { dispatcher } : {}),
      } as any);
      if ([401, 403, 429, 529].includes(response.status)) {
        await sleep(900 * attempt);
        continue;
      }
      if (!response.ok) return null;
      return await response.text();
    } catch {
      await sleep(800 * attempt);
    }
  }
  return null;
}

export async function scrapeMyntra(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
  for (const query of context.input.searchQueries) {
    let position = 1;
    for (let page = 1; page <= context.input.maxPagesPerQuery && records.length < context.maxResults; page += 1) {
      const html = await fetchHtml(buildSearchUrl(query, page), context);
      if (!html) break;
      const products = productsFromMyx(extractMyxData(html));
      if (products.length === 0) break;
      const mapped = products.map((product, index) => toRecord(product, query, position + index)).filter((item): item is ProductRecord => item !== null);
      records.push(...mapped.slice(0, context.maxResults - records.length));
      position += products.length;
      await sleep(700 + Math.floor(Math.random() * 700));
    }
    if (records.length >= context.maxResults) break;
  }
  return records;
}

