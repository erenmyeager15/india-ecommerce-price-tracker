import { normalizeProductTargets } from './matching.js';
import type { ActorInput, NormalizedInput, ProductTargetInput, ProxyInput, SourceName } from './types.js';

export const SOURCE_NAMES: SourceName[] = [
  'flipkart',
  'myntra',
  'bigbasket',
  'meesho',
];

const DEFAULT_PROXY: ProxyInput = {
  useApifyProxy: true,
  apifyProxyGroups: ['RESIDENTIAL'],
  apifyProxyCountry: 'IN',
};
const INPUT_FIELDS = new Set([
  'sources',
  'searchQueries',
  'targetProducts',
  'city',
  'latitude',
  'longitude',
  'brands',
  'minPrice',
  'maxPrice',
  'inStockOnly',
  'maxResults',
  'maxPagesPerQuery',
  'proxyConfiguration',
]);

function fail(message: string, field?: string): never {
  throw new Error(field ? `Field "${field}": ${message}` : message);
}

function cleanString(value: unknown, field: string, maximumLength = 200): string {
  if (typeof value !== 'string') fail('must be a string.', field);
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) fail('must not be empty.', field);
  if (text.length > maximumLength) fail(`must be at most ${maximumLength} characters.`, field);
  return text;
}

function optionalString(value: unknown, field: string, maximumLength = 200): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return cleanString(value, field, maximumLength);
}

function stringArray(
  value: unknown,
  field: string,
  defaultValue: string[],
  minimumItems: number,
  maximumItems: number,
): string[] {
  if (value === undefined || value === null) return [...defaultValue];
  if (!Array.isArray(value)) fail('must be an array of strings.', field);
  const unique = new Map<string, string>();
  for (const item of value) {
    const text = cleanString(item, field);
    const key = text.toLocaleLowerCase('en-US');
    if (!unique.has(key)) unique.set(key, text);
  }
  const result = [...unique.values()];
  if (result.length < minimumItems) fail(`must contain at least ${minimumItems} item(s).`, field);
  if (result.length > maximumItems) fail(`must contain at most ${maximumItems} items.`, field);
  return result;
}

function numberInRange(value: unknown, field: string, defaultValue: number, minimum: number, maximum: number): number {
  if (value === undefined || value === null || value === '') return defaultValue;
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) fail('must be a finite number.', field);
  if (number < minimum || number > maximum) fail(`must be between ${minimum} and ${maximum}.`, field);
  return number;
}

function integerInRange(value: unknown, field: string, defaultValue: number, minimum: number, maximum: number): number {
  const number = numberInRange(value, field, defaultValue, minimum, maximum);
  if (!Number.isInteger(number)) fail('must be an integer.', field);
  return number;
}

function booleanValue(value: unknown, field: string, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value !== 'boolean') fail('must be a boolean.', field);
  return value;
}

function normalizeSources(value: unknown): SourceName[] {
  const sources = stringArray(value, 'sources', ['bigbasket'], 1, SOURCE_NAMES.length)
    .map((source) => source.toLowerCase());
  const allowed = new Set<string>(SOURCE_NAMES);
  for (const source of sources) {
    if (!allowed.has(source)) fail(`unsupported source "${source}".`, 'sources');
  }
  return sources as SourceName[];
}

function normalizeTargets(value: unknown): ProductTargetInput[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) fail('must be an array of product objects.', 'targetProducts');
  if (value.length < 1 || value.length > 5) fail('must contain between 1 and 5 products.', 'targetProducts');

  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail(`item ${index + 1} must be an object.`, 'targetProducts');
    }
    const object = raw as Record<string, unknown>;
    const allowed = new Set(['name', 'brand', 'packSize', 'variant']);
    const unknown = Object.keys(object).filter((key) => !allowed.has(key));
    if (unknown.length > 0) fail(`item ${index + 1} has unsupported field(s): ${unknown.join(', ')}.`, 'targetProducts');
    return {
      name: cleanString(object.name, `targetProducts[${index}].name`),
      brand: optionalString(object.brand, `targetProducts[${index}].brand`, 100),
      packSize: optionalString(object.packSize, `targetProducts[${index}].packSize`, 100),
      variant: optionalString(object.variant, `targetProducts[${index}].variant`, 100),
    };
  });
}

function normalizeProxy(value: unknown): ProxyInput {
  if (value === undefined || value === null) return { ...DEFAULT_PROXY, apifyProxyGroups: [...(DEFAULT_PROXY.apifyProxyGroups ?? [])] };
  if (typeof value !== 'object' || Array.isArray(value)) fail('must be a proxy configuration object.', 'proxyConfiguration');
  const raw = value as Record<string, unknown>;
  const allowed = new Set(['useApifyProxy', 'apifyProxyGroups', 'apifyProxyCountry', 'proxyUrls']);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(`has unsupported field(s): ${unknown.join(', ')}.`, 'proxyConfiguration');

  const proxyUrls = raw.proxyUrls === undefined
    ? []
    : stringArray(raw.proxyUrls, 'proxyConfiguration.proxyUrls', [], 0, 10).map((value) => {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
        return url.toString();
      } catch {
        fail('must contain only valid HTTP or HTTPS URLs.', 'proxyConfiguration.proxyUrls');
      }
    });
  if (proxyUrls.length > 0) return { useApifyProxy: false, proxyUrls };

  const useApifyProxy = booleanValue(raw.useApifyProxy, 'proxyConfiguration.useApifyProxy', true);
  if (!useApifyProxy) return { useApifyProxy: false };
  const groups = stringArray(raw.apifyProxyGroups, 'proxyConfiguration.apifyProxyGroups', ['RESIDENTIAL'], 1, 10)
    .map((group) => group.toUpperCase());
  const country = optionalString(raw.apifyProxyCountry, 'proxyConfiguration.apifyProxyCountry', 2)?.toUpperCase() ?? 'IN';
  if (!/^[A-Z]{2}$/.test(country)) fail('must be a two-letter country code.', 'proxyConfiguration.apifyProxyCountry');
  return { useApifyProxy: true, apifyProxyGroups: groups, apifyProxyCountry: country };
}

export function normalizeInput(value: ActorInput | null | undefined): NormalizedInput {
  const raw = value ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Input must be a JSON object.');
  const unknown = Object.keys(raw).filter((key) => !INPUT_FIELDS.has(key));
  if (unknown.length > 0) fail(`Unsupported input field(s): ${unknown.join(', ')}.`);

  const rawObject = raw as Record<string, unknown>;
  const targetInputs = normalizeTargets(rawObject.targetProducts);
  const searchQueries = stringArray(rawObject.searchQueries, 'searchQueries', ['milk'], targetInputs ? 0 : 1, 10);
  const targetProducts = normalizeProductTargets(targetInputs, searchQueries);
  if (targetProducts.length === 0) fail('Provide at least one search query or product target.');
  const minPrice = numberInRange(rawObject.minPrice, 'minPrice', 0, 0, 1_000_000);
  const maxPrice = numberInRange(rawObject.maxPrice, 'maxPrice', 1_000_000, 0, 1_000_000);
  if (maxPrice < minPrice) fail('must be greater than or equal to minPrice.', 'maxPrice');

  return {
    sources: normalizeSources(rawObject.sources),
    searchQueries: targetProducts.map((target) => target.searchQuery),
    targetProducts,
    city: rawObject.city === undefined ? 'Mumbai' : cleanString(rawObject.city, 'city', 100),
    latitude: numberInRange(rawObject.latitude, 'latitude', 19.076, -90, 90),
    longitude: numberInRange(rawObject.longitude, 'longitude', 72.8777, -180, 180),
    brands: new Set(stringArray(rawObject.brands, 'brands', [], 0, 20).map((brand) => brand.toLowerCase())),
    minPrice,
    maxPrice,
    inStockOnly: booleanValue(rawObject.inStockOnly, 'inStockOnly', false),
    maxResults: integerInRange(rawObject.maxResults, 'maxResults', 1, 1, 1000),
    maxPagesPerQuery: integerInRange(rawObject.maxPagesPerQuery, 'maxPagesPerQuery', 1, 1, 25),
    proxyConfiguration: normalizeProxy(rawObject.proxyConfiguration),
  };
}
