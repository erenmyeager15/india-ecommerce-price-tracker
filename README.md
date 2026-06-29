# India E-commerce Price Tracker

Compare public product prices, discounts, ratings, stock signals, and listing URLs across seven Indian and cross-border marketplaces in one normalized Apify dataset.

The Actor is built for competitor monitoring, assortment research, and recurring price snapshots. It saves product-level facts only and does not intentionally collect seller contacts, reviewer identities, emails, phone numbers, or other personal data.

## What It Extracts

- Product identity: source, search query, result position, product ID, title, brand, category, size, or variant.
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

Each source runs independently. If one source is blocked or changes its page structure, the Actor logs that failure and continues with the remaining selected sources.

## Quick Start

### Lowest-cost first run

This matches the Store sample and uses a source recently verified without a proxy.

```json
{
  "sources": ["myntra"],
  "searchQueries": ["kurti"],
  "maxResults": 3,
  "maxPagesPerQuery": 1,
  "proxyConfiguration": {
    "useApifyProxy": false
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
| `sources` | array | `["myntra"]` | One or more supported marketplace input values. |
| `searchQueries` | array | `["kurti"]` | Product keywords to search. |
| `city` | string | `Mumbai` | Location label used by BigBasket, Blinkit, and JioMart. |
| `latitude` | number | `19.076` | Latitude for location-aware catalogs. |
| `longitude` | number | `72.8777` | Longitude for location-aware catalogs. |
| `brands` | array | Empty | Optional case-insensitive exact brand filters. |
| `minPrice` | number | `0` | Minimum numeric product price to keep. |
| `maxPrice` | number | `1000000` | Maximum numeric product price to keep. |
| `inStockOnly` | boolean | `false` | Keep only records explicitly identified as in stock. |
| `maxResults` | integer | `10` | Maximum clean records saved across all selected sources, capped at `1000`. |
| `maxPagesPerQuery` | integer | `1` | Maximum pages or scroll payloads inspected per query and source, capped at `25`. |
| `proxyConfiguration` | object | No proxy | Optional Apify Proxy settings. India residential proxy is recommended when a source blocks or localizes requests. |

Brand filters are exact after case normalization. Records with unknown stock are excluded when `inStockOnly` is enabled. Products without a numeric price are retained only when the full default price range is used.

## Output Overview

Each dataset item follows the same field order for predictable CSV, Excel, JSON, and API exports.

| Field group | Fields |
| --- | --- |
| Source and identity | `source`, `searchQuery`, `position`, `productId`, `title`, `brand`, `category` |
| Price and variant | `price`, `mrp`, `discountPercent`, `currency`, `packSize` |
| Market signals | `rating`, `ratingCount`, `inStock` |
| Links and timing | `productUrl`, `imageUrl`, `scrapedAt` |

## Verified Sample Output

The following record came from a successful Myntra run on June 23, 2026.

```json
{
  "source": "myntra",
  "searchQuery": "kurti",
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

## Export Quality

Before a product is saved, the Actor normalizes and validates it:

- every row has the same 18 output fields in the same order
- numeric fields are finite numbers or `null`
- missing text uses `N/A` only where that is clearer in spreadsheets
- product and image links are absolute HTTP(S) URLs or `null`
- invalid or duplicate records are skipped
- records are saved and charged atomically

## Tips For Better Results

- Start with one source, one query, one page, and 3-10 results.
- Use broad product terms for discovery and exact brand filters for monitoring.
- Split unrelated product categories into separate runs so result caps are easier to interpret.
- Use Mumbai coordinates only as a sample; set the city and coordinates to the quick-commerce market you need.
- Enable an India residential proxy only when the selected source needs it.
- Schedule the same input and compare `price`, `mrp`, `discountPercent`, and `inStock` over time.

## Known Limits

- Marketplace layouts, public APIs, anti-bot systems, and regional catalogs can change without notice.
- Location-aware results can differ by city, coordinates, inventory zone, and run time.
- Some sources do not expose stock, rating, image, brand, or MRP data for every listing; those fields remain `null` or `N/A`.
- AliExpress can return a non-INR currency depending on the public listing response.
- `maxResults` is shared across selected sources. Capacity unused by an earlier source is made available to later sources.
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
