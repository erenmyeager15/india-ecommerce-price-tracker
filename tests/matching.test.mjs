import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBestProductMatch,
  buildComparisonReport,
  normalizeProductTargets,
} from '../dist/matching.js';
import { normalizeProductRecord } from '../dist/utils.js';

function product(overrides = {}) {
  return normalizeProductRecord({
    source: 'bigbasket',
    searchQuery: 'Amul Gold Full Cream Milk 1 L',
    position: 1,
    productId: 'amul-gold-1l',
    title: 'Amul Gold Full Cream Milk',
    brand: 'Amul',
    price: 72,
    mrp: 72,
    discountPercent: null,
    currency: 'INR',
    packSize: '1 L',
    category: 'Milk',
    rating: 4.5,
    ratingCount: 100,
    inStock: true,
    productUrl: 'https://example.com/amul-gold',
    imageUrl: null,
    scrapedAt: '2026-07-11T12:00:00.000Z',
    ...overrides,
  });
}

const targets = normalizeProductTargets([
  { name: 'Amul Gold Full Cream Milk', brand: 'Amul', packSize: '1 L', variant: 'Gold Full Cream' },
  { name: 'Mother Dairy Full Cream Milk', brand: 'Mother Dairy', packSize: '1 L', variant: 'Full Cream' },
], []);

test('structured targets generate focused searches without repeated descriptors', () => {
  assert.equal(targets[0].searchQuery, 'Amul Gold Full Cream Milk 1 L');
  assert.equal(targets[0].brand, 'Amul');
});

test('an exact title, brand, pack, and variant produces an exact match', () => {
  const matched = applyBestProductMatch(product(), targets);
  assert.equal(matched.targetProduct, 'Amul Gold Full Cream Milk');
  assert.equal(matched.matchConfidence, 'exact');
  assert.equal(matched.matchScore, 100);
  assert.match(matched.matchReason, /brand matched Amul/);
  assert.match(matched.matchReason, /pack matched 1 l/);
});

test('an extra variant remains high confidence instead of being called exact', () => {
  const taazaTargets = normalizeProductTargets([
    { name: 'Amul Taaza Milk', brand: 'Amul', packSize: '1 L', variant: 'Taaza' },
  ], []);
  const matched = applyBestProductMatch(product({
    title: 'Amul Taaza Toned Milk',
    productId: 'amul-taaza-1l',
  }), taazaTargets);
  assert.equal(matched.matchConfidence, 'high');
  assert.ok(matched.matchScore >= 75);
});

test('a conflicting pack size is exposed and downgraded', () => {
  const matched = applyBestProductMatch(product({ packSize: '500 ml' }), targets);
  assert.equal(matched.matchConfidence, 'likely');
  assert.match(matched.matchReason, /pack conflicts: 500 ml/);
});

test('the best target is selected across multiple product definitions', () => {
  const matched = applyBestProductMatch(product({
    title: 'Mother Dairy Full Cream Milk',
    brand: 'Mother Dairy',
    productId: 'mother-dairy-1l',
  }), targets);
  assert.equal(matched.targetProduct, 'Mother Dairy Full Cream Milk');
  assert.equal(matched.matchConfidence, 'exact');
});

test('the report keeps the best candidate per source and shows price spread', () => {
  const bigBasket = applyBestProductMatch(product(), targets);
  const weakerBigBasket = applyBestProductMatch(product({
    productId: 'amul-gold-500ml',
    title: 'Amul Gold Milk Small Pack',
    packSize: '500 ml',
    price: 38,
    productUrl: 'https://example.com/weaker-bigbasket-candidate',
  }), targets);
  const blinkit = applyBestProductMatch(product({
    source: 'blinkit',
    productId: 'amul-gold-blinkit',
    price: 74,
    productUrl: 'https://example.com/blinkit-amul-gold',
  }), targets);
  const input = {
    sources: ['bigbasket', 'blinkit'],
    searchQueries: targets.map((target) => target.searchQuery),
    targetProducts: targets,
    city: 'Mumbai',
    latitude: 19.076,
    longitude: 72.8777,
    brands: new Set(),
    minPrice: 0,
    maxPrice: 1000000,
    inStockOnly: false,
    maxResults: 10,
    maxPagesPerQuery: 1,
    proxyConfiguration: { useApifyProxy: false },
  };
  const report = buildComparisonReport([weakerBigBasket, bigBasket, blinkit], input);
  assert.match(report, /## Amul Gold Full Cream Milk/);
  assert.match(report, /Observed price spread: INR 2/);
  assert.doesNotMatch(report, /weaker-bigbasket-candidate/);
  assert.match(report, /No candidate was saved for this target/);
});
