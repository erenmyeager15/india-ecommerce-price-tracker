# India E-commerce Price Tracker

Discover comparable products and review public prices, discounts, ratings, stock signals, and listing URLs across seven Indian and cross-border marketplaces in one normalized Apify dataset.

The Actor is built for competitor monitoring, assortment research, and recurring price snapshots. Structured product targets receive an explainable confidence score based on product-name terms, brand, pack size, and variant evidence. It saves product-level facts only and does not intentionally collect seller contacts, reviewer identities, emails, phone numbers, or other personal data.

## What It Extracts

- Product identity: source, search query, result position, product ID, title, brand, category, size, or variant.
- Product matching: target product, confidence (`exact`, `high`, `likely`, or `needs_review`), numeric score, and human-readable match evidence.
- Pricing: current price, MRP/list price, discount percentage, and currency.
- Market signals: aggregate rating, rating count, and stock status when exposed by the source.
- Links and media: absolute product URL and image URL.
- Monitoring metadata: an ISO scrape timestamp on every record.

## Supported Sources

| Source | Input value | Best for | Location-aware |
| --- | --- | --- | --- |
| Flipkart | `flipkart` | General retail and electronics | No |
| Myntra | `myntra` | Fashion, footwear, and accessories | No |
| BigBasket | `bigbasket` | Grocery and household products | Yes |
| Blinkit | `blinkit` | Quick-commerce availability and prices | Yes |
| JioMart | `jiomart` | Grocery and general retail | Yes |
| Meesho | `meesho` | Value fashion and marketplace catalogs | No |
| AliExpress | `aliexpress` | Cross-border product comparisons | No |

Each source runs independently. If one source is blocked or changes its payload, the Actor records a sanitized failure in `SOURCE_STATUS` and continues with the remaining selected sources. Explicit no-result pages remain distinct from parser or anti-bot failures.

## Quick Start

### Product discovery and comparison

Use structured targets when you know the products but not every competitor URL. The Actor derives one marketplace search per target and scores the returned candidates.

```json
{
  "sources": ["bigbasket", "blinkit"],
  "targetProducts": [
    {
      "name": "Amul Gold Full Cream Milk",
      "brand": "Amul",
      "packSize": "1 L",
      "variant": "Gold Full Cream"
    },
    {
      "name": "Amul Taaza Milk",
      "brand": "Amul",
      "packSize": "1 L",
      "variant": "Taaza"
    },
    {
      "name": "Mother Dairy Full Cream Milk",
      "brand": "Mother Dairy",
      "packSize": "1 L",
      "variant": "Full Cream"
    }
  ],
  "city": "Mumbai",
  "latitude": 19.076,
  "longitude": 72.8777,
  "maxResults": 20,
  "maxPagesPerQuery": 1,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "IN"
  }
}
```

This mode is intended for 3-5 deliberate targets. Confidence remains visible so ambiguous matches can be reviewed instead of silently accepted.

### Store QA-sized first run

This matches the bounded Store prefill used by Apify's automated quality check.

```json
{
  "sources": ["bigbasket"],
  "targetProducts": [
    {
      "name": "Amul Gold Full Cream Milk",
      "brand": "Amul",
      "packSize": "1 L",
      "variant": "Gold Full Cream"
    }
  ],
  "maxResults": 1,
  "maxPagesPerQuery": 1,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "IN"
  }
}
```

### Multi-market price snapshot

```json
{
  "sources": ["flipkart", "myntra", "meesho"],
  "searchQueries": ["wireless earbuds"],
  "minPrice": 500,
  "maxPrice": 5000,
  "maxResults": 20,
  "maxPagesPerQuery": 1,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "IN"
  }
}
```

### Location-aware grocery search

```json
{
  "sources": ["bigbasket", "blinkit", "jiomart"],
  "searchQueries": ["milk"],
  "city": "Mumbai",
  "latitude": 19.076,
  "longitude": 72.8777,
  "inStockOnly": true,
  "maxResults": 15,
  "maxPagesPerQuery": 1,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "IN"
  }
}
```

## Input Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `sources` | array | `["bigbasket"]` | One or more supported marketplace input values. |
| `targetProducts` | array | Empty | Up to five structured product definitions with name, optional brand, pack size, and variant. |
| `searchQueries` | array | `["milk"]` | Broad product-discovery keywords. Ignored when `targetProducts` is supplied. |
| `city` | string | `Mumbai` | Location label used by BigBasket, Blinkit, and JioMart. |
| `latitude` | number | `19.076` | Latitude for location-aware catalogs. |
| `longitude` | number | `72.8777` | Longitude for location-aware catalogs. |
| `brands` | array | Empty | Optional case-insensitive exact brand filters. |
| `minPrice` | number | `0` | Minimum numeric product price to keep. |
| `maxPrice` | number | `1000000` | Maximum numeric product price to keep. |
| `inStockOnly` | boolean | `false` | Keep only records explicitly identified as in stock. |
| `maxResults` | integer | `1` | Maximum clean records saved across all selected sources, capped at `1000`. |
| `maxPagesPerQuery` | integer | `1` | Maximum pages or scroll payloads inspected per query and source, capped at `25`. |
| `proxyConfiguration` | object | India residential | Optional Apify Proxy settings. Disable it for a deliberate proxy-free test only when the selected source supports that path. |

Brand filters are exact after case normalization. Records with unknown stock are excluded when `inStockOnly` is enabled. Products without a numeric price or a source-owned product URL are never saved or charged.

## Output Overview

Each dataset item follows the same field order for predictable CSV, Excel, JSON, and API exports.

| Field group | Fields |
| --- | --- |
| Source and identity | `source`, `searchQuery`, `position`, `productId`, `title`, `brand`, `category` |
| Match decision | `targetProduct`, `matchConfidence`, `matchScore`, `matchReason` |
| Price and variant | `price`, `mrp`, `discountPercent`, `currency`, `packSize` |
| Market signals | `rating`, `ratingCount`, `inStock` |
| Links and timing | `productUrl`, `imageUrl`, `scrapedAt` |

## Verified Sample Output

The product facts in the following record came from a successful Myntra run on June 23, 2026. The matching fields show how broad keyword discovery is conservatively labeled after the v2 matching upgrade.

```json
{
  "source": "myntra",
  "searchQuery": "kurti",
  "targetProduct": "kurti",
  "matchConfidence": "likely",
  "matchScore": 65,
  "matchReason": "name 1/1 terms",
  "position": 1,
  "productId": "32402499",
  "title": "Sangria Women Embroidered Tie Up Neck Short Top",
  "brand": "Sangria",
  "price": 575,
  "mrp": 1799,
  "discountPercent": 68,
  "currency": "INR",
  "packSize": "S, M, L, XL, XXL",
  "category": "Kurtis",
  "rating": 4,
  "ratingCount": 518,
  "inStock": null,
  "productUrl": "https://www.myntra.com/kurtis/sangria/sangria-women-embroidered-tie-up-neck-short-top/32402499/buy",
  "imageUrl": "https://assets.myntassets.com/assets/images/2025/JANUARY/20/Ddbz2VT6_d952864492a042c2af83594217f21ef6.jpg",
  "scrapedAt": "2026-06-23T13:06:09.076Z"
}
```

## Historical Cross-Store Comparison Example

This is a public-data capability sample from a successful June 19, 2026 run for `milk`. It demonstrates conservative matching, not live price monitoring or a client report. The current Actor automates the same confidence discipline and exposes the evidence on each row.

| Product | BigBasket | Blinkit | Difference | Match confidence | Action note |
| --- | ---: | ---: | --- | --- | --- |
| Amul Gold Full Cream Milk, 1 L | INR 72, in stock | INR 72, in stock | INR 0 (0.0%) | Exact | Same public price in this stored snapshot. |
| Amul Taaza Milk, 1 L | INR 57, in stock | INR 59, in stock | Blinkit +INR 2 (+3.5%) | High | Brand, Taaza product family, and 1 L pack match. Blinkit includes `Toned`; verify the product page before acting. |
| Mother Dairy Full Cream Milk, 1 L | INR 72, in stock | No safe match in the stored Blinkit result set | Not compared | Needs review | Do not infer a competitor price. Add a known competitor URL or broaden the search. |

The Blinkit rows were captured for Mumbai, while the stored BigBasket rows did not expose a city. Re-run both sources for the same city before using any price difference in a business decision. Product titles that are merely similar are excluded instead of being silently compared.

## Export Quality

Before a product is saved, the Actor normalizes and validates it:

- every row has the same 22 output fields in the same order
- numeric fields are finite numbers or `null`
- missing text uses `N/A` only where that is clearer in spreadsheets
- product links are required source-owned HTTPS URLs; image links are absolute HTTPS URLs or `null`
- invalid or duplicate records are skipped
- records are saved and charged atomically

Each run also writes two default key-value-store records. `MATCH_REPORT` keeps the best saved candidate per source and shows any observed price spread. `SOURCE_STATUS` reports every selected source as `results`, `empty`, `failed`, or `not_run`, with candidate count, saved count, duration, and sanitized error details.

## Tips For Better Results

- Start with one source, one query, one page, and 1-3 results.
- The default run uses 1 GB of memory; increase it only if a larger multi-source browser run proves it needs more.
- Use broad product terms for discovery and exact brand filters for monitoring.
- Split unrelated product categories into separate runs so result caps are easier to interpret.
- Use Mumbai coordinates only as a sample; set the city and coordinates to the quick-commerce market you need.
- Enable an India residential proxy only when the selected source needs it.
- Schedule the same input and compare `price`, `mrp`, `discountPercent`, and `inStock` over time.

## Known Limits

- Marketplace layouts, public APIs, anti-bot systems, and regional catalogs can change without notice.
- Location-aware results can differ by city, coordinates, inventory zone, and run time.
- Blinkit browser searches can be slow and may return zero candidates when the public search payload is unavailable. Start with BigBasket for predictable matching validation; a cross-store price spread appears only when at least two sources return candidates.
- Some sources do not expose stock, rating, image, brand, or MRP data for every listing; those fields remain `null` or `N/A`.
- AliExpress can return a non-INR currency depending on the public listing response.
- `maxResults` is shared across selected sources. Capacity unused by an earlier source is made available to later sources.
- Each structured target receives a small per-source search budget so the first product cannot consume the entire comparison run. Set `maxResults` to at least the number of targets multiplied by the number of sources when every target/source pair matters.
- Matching is heuristic. Similar names can still describe different variants, bundles, or regional listings, so `likely` and `needs_review` rows require source-page review.
- A run fails when no selected source produces a valid product, making empty outputs visible in monitoring.

## Pricing

This Actor uses pay-per-event pricing. The currently active Store prices are:

| Event | When charged | Price |
| --- | --- | ---: |
| `apify-actor-start` | At run start; event count depends on memory (one per GB, minimum one) | `$0.00005` per event |
| `product-scraped` | One clean product record saved | `$0.002` |

The Actor stops adding records when the user's maximum cost per run is reached. Apify displays the authoritative current event prices before a run; scheduled pricing updates may take effect later than documentation changes.

## Data Safety

The Actor is limited to public product-level information. It does not intentionally output seller names, merchant IDs, reviewer identities, emails, phone numbers, or contact fields. Email- and phone-like strings found in text are redacted before output.

## Responsible Use

This Actor is intended for lawful collection and processing of publicly available product information. Users are responsible for complying with source terms, robots.txt, applicable privacy laws, India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
