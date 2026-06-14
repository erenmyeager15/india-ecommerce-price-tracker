# India E-commerce Price Tracker

Track public product catalog and price data from major Indian e-commerce marketplaces in one normalized Apify dataset.

Supported sources:
- Flipkart
- Myntra
- BigBasket
- Blinkit
- JioMart
- Meesho
- AliExpress

The Actor extracts product-only facts: product ID, title, brand, price, MRP, discount, currency, pack size, category, rating value, rating count, stock status, image URL, product URL, source, search query, city, and scrape timestamp.

It does not output seller names, merchant IDs, phone numbers, emails, reviewer identities, or other personal data.

## Input

| Field | Type | Description |
| --- | --- | --- |
| `sources` | array | Sources to query. One blocked source is skipped while others continue. |
| `searchQueries` | array | Product keywords such as `milk`, `kurti`, or `iphone case`. |
| `city` | string | Location name for location-aware sources. |
| `latitude`, `longitude` | number | Coordinates for Blinkit and JioMart. |
| `brands` | array | Optional exact brand filters. |
| `minPrice`, `maxPrice` | number | Optional price range. |
| `inStockOnly` | boolean | Keep only records clearly marked in stock. |
| `maxResults` | integer | Maximum saved records across selected sources. |
| `maxPagesPerQuery` | integer | Per-source pagination/scroll limit. |
| `proxyConfiguration` | object | India residential proxy is recommended. |

## Sample Output

```json
{
  "source": "bigbasket",
  "searchQuery": "milk",
  "position": 1,
  "productId": "40022638",
  "title": "Amul Taaza Toned Milk",
  "brand": "Amul",
  "price": 30,
  "mrp": 30,
  "discountPercent": null,
  "currency": "INR",
  "packSize": "500 ml",
  "category": "Bakery, Cakes & Dairy",
  "rating": 4.5,
  "ratingCount": 1200,
  "inStock": true,
  "imageUrl": "https://...",
  "productUrl": "https://...",
  "city": "Mumbai",
  "scrapedAt": "2026-06-14T07:00:00.000Z"
}
```

## Use Cases

- Price monitoring across marketplaces
- Competitor price and discount tracking
- Assortment and availability research
- Grocery and fashion catalog intelligence
- Marketplace market research

## Pricing

This Actor uses pay per event pricing.

| Event | Price |
| --- | ---: |
| `product-scraped` | `$0.002` per clean product record |

## Known Limits

These are commercial websites with anti-bot systems and regional catalogs. Use an India residential proxy for best results. Some sources may occasionally block or return no results; the Actor isolates each source and continues with the remaining selected sources.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with the source website's terms, robots.txt, applicable privacy laws, including India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0

