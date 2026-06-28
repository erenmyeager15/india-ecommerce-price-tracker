# India E-commerce Price Tracker

Track public product catalog and price data from major Indian e-commerce marketplaces in one clean, normalized Apify dataset.

This Actor collects product-only facts such as title, brand, price, MRP, discount, rating, stock status, image URL, and product URL. Output is normalized for CSV, Excel, JSON, API exports, and scheduled monitoring workflows.

Supported sources:

- Flipkart
- Myntra
- BigBasket
- Blinkit
- JioMart
- Meesho
- AliExpress

The Actor does not intentionally output seller names, merchant IDs, phone numbers, emails, reviewer identities, or other personal data.

## Input

Use the input form to choose one or more marketplaces, search queries, result limits,
price filters, and optional location settings for quick-commerce sources.

| Field | Type | Description |
| --- | --- | --- |
| `sources` | string[] | Marketplaces to scrape, such as `flipkart`, `myntra`, `bigbasket`, `blinkit`, `jiomart`, `meesho`, or `aliexpress`. |
| `searchQueries` | string[] | Product keywords to search, for example `milk`, `kurti`, `iphone`, or `wireless earbuds`. |
| `city` | string | Optional city label used by location-aware sources such as Blinkit and JioMart. |
| `latitude` / `longitude` | number | Optional coordinates for location-specific grocery and quick-commerce results. |
| `minPrice` / `maxPrice` | number | Optional numeric price range filter. |
| `inStockOnly` | boolean | Return only products that are clearly available when the source exposes stock status. |
| `maxResults` | integer | Maximum product records to save per run. Start with 5-10 for tests. |
| `maxPagesPerQuery` | integer | Number of result pages to inspect per search query, where supported. |
| `proxyConfiguration` | object | Apify Proxy settings. India residential proxy is recommended for Indian marketplace sources. |

## Example input

```json
{
  "sources": ["flipkart", "myntra", "bigbasket", "meesho"],
  "searchQueries": ["milk"],
  "city": "Mumbai",
  "latitude": 19.076,
  "longitude": 72.8777,
  "minPrice": 0,
  "maxPrice": 1000000,
  "inStockOnly": false,
  "maxResults": 10,
  "maxPagesPerQuery": 1,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "IN"
  }
}
```

## Example output

```json
{
  "source": "bigbasket",
  "searchQuery": "milk",
  "position": 1,
  "productId": "40147597",
  "title": "Daily Health Toned Milk",
  "brand": "Heritage",
  "price": 32,
  "mrp": 32,
  "discountPercent": null,
  "currency": "INR",
  "packSize": "500 ml",
  "category": "Bakery, Cakes & Dairy",
  "rating": 3.7,
  "ratingCount": 18426,
  "inStock": true,
  "productUrl": "https://www.bigbasket.com/pd/40147597/heritage-daily-health-toned-milk-500-ml-pouch/",
  "imageUrl": "https://www.bigbasket.com/media/uploads/p/l/40147597_1-heritage-daily-health-toned-milk.jpg",
  "scrapedAt": "2026-06-23T12:00:00.000Z"
}
```

## Output fields

Every dataset item uses the same field names and field order.

| Field | Type | Description |
| --- | --- | --- |
| `source` | string | Marketplace or source name. |
| `searchQuery` | string | Original search query used for the record. |
| `position` | number or null | Result rank/order starting from 1 when available. |
| `productId` | string or null | Stable product/listing ID when available. |
| `title` | string | Product title. Uses `N/A` only when a source returns no title. |
| `brand` | string | Product brand, or `N/A` when unavailable. |
| `price` | number or null | Current numeric price only. |
| `mrp` | number or null | Numeric MRP/list price when available. |
| `discountPercent` | number or null | Numeric discount percentage, for example `40`. |
| `currency` | string | Currency code such as `INR` or `USD`. |
| `packSize` | string | Size, quantity, or variant text, or `N/A`. |
| `category` | string | Product category, or `N/A`. |
| `rating` | number or null | Product rating rounded to one decimal where needed. |
| `ratingCount` | number or null | Numeric rating/review count when available. |
| `inStock` | boolean or null | `true` if clearly available, `false` if clearly unavailable, `null` if unknown. |
| `productUrl` | string or null | Absolute product URL. |
| `imageUrl` | string or null | Absolute image URL. Placeholder values such as `Proxied content` are not used. |
| `scrapedAt` | string | ISO timestamp for when the record was created. |

## Export quality

The Actor normalizes each saved item before writing to the dataset:

- no `undefined` values
- no `NaN` values
- numeric fields are numbers or `null`
- missing text fields use `N/A` where that is clearer for spreadsheets
- image and product URLs are absolute URLs or `null`
- all rows share the same schema for clean CSV/Excel/JSON export

## Use cases

- Price monitoring across Indian marketplaces
- Competitor price and discount tracking
- Product assortment research
- Grocery and fashion catalog intelligence
- Clean product datasets for Excel, Google Sheets, BI tools, or APIs

## Pricing

This Actor uses pay-per-event pricing.

| Event | Price |
| --- | ---: |
| `apify-actor-start` | `$0.001` per run start |
| `product-scraped` | `$0.004` per clean product record |

Product records are charged only when they are saved to the dataset. A small start event covers startup and proxy/session initialization across selected sources.

## Limitations and assumptions

These are commercial websites with changing layouts, regional catalogs, anti-bot systems, and location-specific availability. India residential proxy is recommended for Indian marketplace sources.

Some sources may occasionally block, return fewer products, or return no results. The Actor isolates source failures and continues with the remaining selected sources where possible.

## Responsible data use

This Actor is intended for lawful collection of publicly available product and price information only. Users are responsible for ensuring their use complies with source website terms, robots.txt, applicable privacy laws, India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
