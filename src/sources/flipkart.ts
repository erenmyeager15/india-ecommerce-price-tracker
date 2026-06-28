import * as cheerio from 'cheerio';
import { ProxyAgent } from 'undici';
import type { ProductRecord, SourceContext } from '../types.js';
import { cleanText, discountFromPrices, integerOrNull, numberOrNull, redactText, sleep, withDefaults } from '../utils.js';

const ORIGIN = 'https://www.flipkart.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';

function text($: cheerio.CheerioAPI, el: any, selector: string): string | null {
  return cleanText($(el).find(selector).first().text());
}

function cleanUrl(href: string | undefined): string | null {
  if (!href) return null;
  const absolute = href.replace(/&amp;/g, '&').startsWith('http') ? href.replace(/&amp;/g, '&') : `${ORIGIN}${href.replace(/&amp;/g, '&')}`;
  try {
    const url = new URL(absolute);
    for (const key of [...url.searchParams.keys()]) {
      if (!['pid', 'lid', 'marketplace'].includes(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return absolute;
  }
}

function productIdFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).searchParams.get('pid');
  } catch {
    return null;
  }
}

function parseRatingCounts(value: string | null): { ratingCount: number | null } {
  const ratingMatch = value?.match(/([\d,]+)\s+Ratings?/i);
  return { ratingCount: integerOrNull(ratingMatch?.[1]) };
}

function parseCard($: cheerio.CheerioAPI, el: any, searchQuery: string, position: number): ProductRecord | null {
  const card = $(el);
  const link = card.find('a[href*="/p/"]').first();
  const productUrl = cleanUrl(link.attr('href'));
  const image = card.find('img[src*="rukminim"]').first();
  const title = redactText(image.attr('alt')) ?? text($, el, '.RG5Slk') ?? text($, el, '.syl9yP') ?? redactText(link.text());
  if (!title || !productUrl) return null;

  const priceDisplay = text($, el, '.hZ3P6w');
  const mrpDisplay = text($, el, '.kRYCnD');
  const price = numberOrNull(priceDisplay);
  const parsedMrp = numberOrNull(mrpDisplay);
  const mrp = parsedMrp !== null && price !== null && parsedMrp > price ? parsedMrp : null;
  const discountText = text($, el, '.HQe8jr')
    ?? card.find('*').map((_, node) => cleanText($(node).text())).get().find((item) => /^\d+\s*%\s*off$/i.test(item ?? ''))
    ?? null;
  const discountPercent = integerOrNull(discountText?.match(/^(\d+)\s*%/i)?.[1]) ?? discountFromPrices(price, mrp);
  const rating = numberOrNull(text($, el, '.MKiFS6'));
  const counts = parseRatingCounts(text($, el, '.PvbNMB'));

  return withDefaults({
    source: 'flipkart',
    searchQuery,
    position,
    productId: card.attr('data-id') ?? productIdFromUrl(productUrl),
    title,
    brand: null,
    price,
    mrp,
    discountPercent,
    currency: 'INR',
    packSize: null,
    category: null,
    rating,
    ratingCount: counts.ratingCount,
    inStock: null,
    imageUrl: image.attr('src') ?? image.attr('data-src') ?? null,
    productUrl,
  });
}

function parseSearchResults(html: string, searchQuery: string, startPosition: number): ProductRecord[] {
  const $ = cheerio.load(html);
  const records: ProductRecord[] = [];
  const seen = new Set<string>();
  $('[data-id]').each((_, el) => {
    const parsed = parseCard($, el, searchQuery, startPosition + records.length);
    if (!parsed) return;
    const key = parsed.productId ?? parsed.productUrl ?? parsed.title ?? '';
    if (seen.has(key)) return;
    seen.add(key);
    records.push(parsed);
  });
  return records;
}

function buildSearchUrl(query: string, page: number): string {
  const url = new URL(`${ORIGIN}/search`);
  url.searchParams.set('q', query);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

async function fetchHtml(url: string, context: SourceContext): Promise<string | null> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const proxyUrl = await context.proxyConfiguration?.newUrl(`flipkart_${attempt}`);
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
      if ([403, 429, 529].includes(response.status)) {
        await sleep(900 * attempt);
        continue;
      }
      if (!response.ok) return null;
      return await response.text();
    } catch {
      await sleep(700 * attempt);
    }
  }
  return null;
}

export async function scrapeFlipkart(context: SourceContext): Promise<ProductRecord[]> {
  const records: ProductRecord[] = [];
  for (const query of context.input.searchQueries) {
    let position = 1;
    for (let page = 1; page <= context.input.maxPagesPerQuery && records.length < context.maxResults; page += 1) {
      const html = await fetchHtml(buildSearchUrl(query, page), context);
      if (!html) break;
      const parsed = parseSearchResults(html, query, position);
      if (parsed.length === 0) break;
      records.push(...parsed.slice(0, context.maxResults - records.length));
      position += parsed.length;
      await sleep(600 + Math.floor(Math.random() * 700));
    }
    if (records.length >= context.maxResults) break;
  }
  return records;
}
