import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInput } from '../dist/input.js';
import {
  OUTPUT_FIELDS,
  absoluteUrl,
  discountFromPrices,
  hasForbiddenField,
  normalizeProductRecord,
  parseCompactCount,
  shouldKeepProduct,
  validateProductRecord,
} from '../dist/utils.js';

function product(overrides = {}) {
  return normalizeProductRecord({
    source: 'bigbasket',
    searchQuery: 'milk',
    targetProduct: 'milk',
    matchConfidence: 'high',
    matchScore: 88,
    matchReason: 'name matched',
    position: 1,
    productId: '123',
    title: 'Amul Gold Milk 1 L',
    brand: 'Amul',
    price: 72,
    mrp: 75,
    discountPercent: 4,
    currency: 'inr',
    packSize: '1 L',
    category: 'Milk',
    rating: 4.5,
    ratingCount: 120,
    inStock: true,
    productUrl: 'https://www.bigbasket.com/pd/123/amul-gold/',
    imageUrl: 'https://www.bigbasket.com/media/123.jpg',
    scrapedAt: '2026-07-15T12:00:00.000Z',
    ...overrides,
  });
}

test('normalized output has a stable schema order and uppercase currency', () => {
  const record = product();
  assert.deepEqual(Object.keys(record), [...OUTPUT_FIELDS]);
  assert.equal(record.currency, 'INR');
});

test('a complete source-owned product record validates', () => {
  assert.deepEqual(validateProductRecord(product()), []);
});

test('wrong-domain and missing product URLs are rejected', () => {
  assert.match(validateProductRecord(product({ productUrl: 'https://example.com/product' })).join(' '), /bigbasket\.com/);
  assert.match(validateProductRecord(product({ productUrl: null })).join(' '), /productUrl is required/);
});

test('invalid numeric values are rejected before billing', () => {
  assert.match(validateProductRecord(product({ price: -1 })).join(' '), /non-negative/);
  assert.match(validateProductRecord(product({ rating: 6 })).join(' '), /between 0 and 5/);
  assert.match(validateProductRecord(product({ mrp: 50 })).join(' '), /must not be lower/);
  assert.match(validateProductRecord(product({ discountPercent: 120 })).join(' '), /between 0 and 100/);
});

test('price and stock filters reject unusable candidates', () => {
  const input = normalizeInput({ minPrice: 50, maxPrice: 100, inStockOnly: true });
  assert.equal(shouldKeepProduct(product(), input), true);
  assert.equal(shouldKeepProduct(product({ price: 120 }), input), false);
  assert.equal(shouldKeepProduct(product({ inStock: null }), input), false);
  assert.equal(shouldKeepProduct(product({ price: null }), input), false);
});

test('exact brand filters do not accept missing or different brands', () => {
  const input = normalizeInput({ brands: ['Amul'] });
  assert.equal(shouldKeepProduct(product(), input), true);
  assert.equal(shouldKeepProduct(product({ brand: 'N/A' }), input), false);
  assert.equal(shouldKeepProduct(product({ brand: 'Mother Dairy' }), input), false);
});

test('compact Indian and international counts are parsed', () => {
  assert.equal(parseCompactCount('1.2k sold'), 1200);
  assert.equal(parseCompactCount('2 lakh'), 200000);
  assert.equal(parseCompactCount('1.5M'), 1500000);
});

test('relative and protocol-relative URLs become HTTPS URLs', () => {
  assert.equal(absoluteUrl('/pd/123', 'https://www.bigbasket.com'), 'https://www.bigbasket.com/pd/123');
  assert.equal(absoluteUrl('//cdn.example.com/image.jpg', 'https://www.bigbasket.com'), 'https://cdn.example.com/image.jpg');
});

test('discount calculation only accepts a genuine lower selling price', () => {
  assert.equal(discountFromPrices(80, 100), 20);
  assert.equal(discountFromPrices(100, 100), null);
  assert.equal(discountFromPrices(120, 100), null);
});

test('forbidden personal or seller fields are detected', () => {
  assert.equal(hasForbiddenField({ ...product(), sellerEmail: 'x@example.com' }), true);
  assert.equal(hasForbiddenField(product()), false);
});
