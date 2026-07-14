import assert from 'node:assert/strict';
import test from 'node:test';
import { productsFromBigBasketPayload } from '../dist/sources/bigbasket.js';
import { classifyMyxPayload, extractMyxData, toMyntraRecord } from '../dist/sources/myntra.js';
import { classifyFlipkartHtml, parseFlipkartSearchResults } from '../dist/sources/flipkart.js';
import { classifyMeeshoPayload, toMeeshoRecord } from '../dist/sources/meesho.js';
import { extractBlinkitProducts, isBlinkitBlockedText, isBlinkitExplicitEmptyText } from '../dist/sources/blinkit.js';
import {
  countRelevantJioMartPayloads,
  extractJioMartProducts,
  isJioMartProductsApiUrl,
} from '../dist/sources/jiomart.js';
import {
  aliExpressCurrencyFrom,
  parseAliExpressDiscount,
  parseAliExpressMoney,
  parseAliExpressRating,
} from '../dist/sources/aliexpress.js';

test('BigBasket maps a valid listing API product', () => {
  const result = productsFromBigBasketPayload({
    tabs: [{ product_info: {
      number_of_pages: 2,
      products: [{
        id: 'bb-1', desc: 'Amul Gold Milk', absolute_url: '/pd/100/amul-gold/', w: '1 L',
        brand: { name: 'Amul' }, category: { tlc_name: 'Milk' },
        pricing: { discount: { prim_price: { sp: 72 }, mrp: 75 } },
        availability: { avail_status: '001', not_for_sale: false },
        rating_info: { avg_rating: 4.5, rating_count: 100 },
        images: [{ l: 'https://www.bigbasket.com/media/amul.jpg' }],
      }],
    } }],
  }, 'milk', 1);
  assert.equal(result.pages, 2);
  assert.equal(result.products[0].price, 72);
  assert.equal(result.products[0].productUrl, 'https://www.bigbasket.com/pd/100/amul-gold/');
});

test('BigBasket rejects API errors and unexpected payload drift', () => {
  assert.throws(() => productsFromBigBasketPayload({ errors: [{ msg: 'blocked' }] }, 'milk', 1), /blocked/);
  assert.throws(() => productsFromBigBasketPayload({ tabs: [] }, 'milk', 1), /unexpected payload shape/i);
});

test('Myntra extracts and classifies window.__myx payloads', () => {
  const html = '<script>window.__myx = {"searchData":{"results":{"products":[{"productId":1}]}}};</script>';
  const payload = extractMyxData(html);
  assert.equal(classifyMyxPayload(payload).kind, 'products');
  assert.equal(classifyMyxPayload({ searchData: { results: { products: [] } } }).kind, 'empty');
  assert.equal(classifyMyxPayload({}).kind, 'invalid');
});

test('Myntra maps only priced records with a Myntra URL', () => {
  const record = toMyntraRecord({
    productId: 101, productName: 'Roadster Cotton Shirt', brand: 'Roadster', price: 799, mrp: 1599,
    landingPageUrl: '/roadster/shirts/roadster-cotton-shirt/101/buy', sizes: 'M,L',
    inventoryInfo: [{ available: false }, { available: true }],
  }, 'cotton shirt', 1);
  assert.equal(record.price, 799);
  assert.equal(record.inStock, true);
  assert.equal(toMyntraRecord({ productName: 'No price', landingPageUrl: '/x' }, 'x', 1), null);
  assert.equal(toMyntraRecord({ productName: 'External', price: 10, landingPageUrl: 'https://example.com/x' }, 'x', 1), null);
});

const flipkartProductHtml = `
  <html><body><div data-id="FK1">
    <a href="/sample-product/p/itm123?pid=PID123&otracker=search"></a>
    <img src="https://rukminim2.flixcart.com/image/123.jpg" alt="Sample Phone 128 GB">
    <div class="hZ3P6w">Rs. 12,999</div><div class="kRYCnD">Rs. 15,999</div>
    <div class="HQe8jr">18% off</div><div class="MKiFS6">4.4</div><div class="PvbNMB">1,200 Ratings</div>
  </div></body></html>`;

test('Flipkart parses product cards and strips tracking parameters', () => {
  const products = parseFlipkartSearchResults(flipkartProductHtml, 'phone', 1);
  assert.equal(products.length, 1);
  assert.equal(products[0].price, 12999);
  assert.equal(new URL(products[0].productUrl).searchParams.has('otracker'), false);
});

test('Flipkart distinguishes products, explicit empty results, and parser drift', () => {
  assert.equal(classifyFlipkartHtml(flipkartProductHtml, 'phone', 1).kind, 'products');
  assert.equal(classifyFlipkartHtml('<body>Sorry, no results found!</body>', 'none', 1).kind, 'empty');
  assert.equal(classifyFlipkartHtml('<body>Generic storefront shell</body>', 'phone', 1).kind, 'invalid');
});

test('Meesho classifies normal and nested catalog payloads', () => {
  assert.equal(classifyMeeshoPayload({ catalogs: [] }).kind, 'page');
  assert.equal(classifyMeeshoPayload({ data: { catalogs: [{ id: 1 }], cursor: 'next' } }).cursor, 'next');
  assert.equal(classifyMeeshoPayload({ data: {} }).kind, 'invalid');
});

test('Meesho maps a priced product with source-owned URL', () => {
  const record = toMeeshoRecord({
    id: 'catalog-1', product_id: 'p1', name: 'Women Cotton Kurti', brand_name: 'Example',
    min_catalog_price: 499, original_price: 799, original_slug: 'women-cotton-kurti',
    catalog_reviews_summary: { average_rating: 4.2, rating_count: 50 }, in_stock: true,
  }, 'kurti', 1);
  assert.equal(record.price, 499);
  assert.match(record.productUrl, /meesho\.com\/women-cotton-kurti\/p\/p1/);
  assert.equal(toMeeshoRecord({ id: 'x', product_id: 'x', name: 'No price' }, 'x', 1), null);
});

test('Blinkit extracts nested cart items and classifies page state text', () => {
  const products = extractBlinkitProducts([{ widget: { atc_action: { add_to_cart: { cart_item: {
    product_id: 'blink-1', product_name: 'Amul Milk', price: 72, mrp: 75, brand: 'Amul', unit: '1 L', inventory: 3,
  } } } } }], 'milk');
  assert.equal(products.length, 1);
  assert.equal(products[0].inStock, true);
  assert.equal(isBlinkitBlockedText('Access denied', ''), true);
  assert.equal(isBlinkitExplicitEmptyText('No products found'), true);
});

const jioPayloads = [{
  url: 'https://www.jiomart.com/ext/catalog/api/products',
  json: { data: { products: [
    {
      id: 'rice-1', name: 'India Gate Basmati Rice 5 kg', slug: 'india-gate-basmati-rice-5-kg',
      brand: { name: 'India Gate' }, price: { effective: { min: 500 }, marked: { min: 600 }, currency_code: 'INR' },
      hierarchy: { l1_category: { name: 'Grocery' } }, sellable: true,
    },
    {
      id: 'mop-1', name: 'Floor Cleaning Mop', slug: 'floor-cleaning-mop',
      price: { effective: { min: 250 }, marked: { min: 300 } }, sellable: true,
    },
  ] } },
}];

test('JioMart tolerates nested payloads while filtering unrelated products', () => {
  assert.equal(countRelevantJioMartPayloads(jioPayloads, 'rice'), 1);
  const products = extractJioMartProducts(jioPayloads, 'rice');
  assert.equal(products.length, 1);
  assert.match(products[0].title, /Rice/);
  assert.doesNotMatch(products[0].title, /Mop/);
});

test('JioMart product API detection tolerates endpoint version drift', () => {
  assert.equal(isJioMartProductsApiUrl('https://www.jiomart.com/ext/vertex/application/api/v2/products'), true);
  assert.equal(isJioMartProductsApiUrl('https://www.jiomart.com/products?q=rice'), false);
});

test('AliExpress parses international currencies without mojibake', () => {
  assert.equal(parseAliExpressMoney('US $1,299.50'), 1299.5);
  assert.equal(parseAliExpressMoney('\u20ac 12.50'), 12.5);
  assert.equal(aliExpressCurrencyFrom('\u20ac 12.50'), 'EUR');
  assert.equal(aliExpressCurrencyFrom('\u00a3 8.00'), 'GBP');
  assert.equal(aliExpressCurrencyFrom('\u20b9 999'), 'INR');
});

test('AliExpress bounds discount and rating values', () => {
  assert.equal(parseAliExpressDiscount('-35%'), 35);
  assert.equal(parseAliExpressDiscount('120%'), null);
  assert.equal(parseAliExpressRating('4.8'), 4.8);
  assert.equal(parseAliExpressRating('8'), null);
});
