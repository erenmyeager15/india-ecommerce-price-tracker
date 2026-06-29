# India E-commerce Price Tracker Promotion Notes

## YouTube Tutorial Title Options

- Compare Indian E-commerce Prices with Apify: Flipkart, Myntra, Meesho and More
- India E-commerce Price Tracker Tutorial: Export Prices, Discounts and Stock
- Build a Competitor Price Monitoring Dataset Across Indian Marketplaces

## 60-Second Tutorial Script

1. Show the Actor page: "This Actor normalizes public product and price data across seven marketplaces."
2. Open the input form and select one source for the first run.
3. Use `myntra` with the query `kurti`.
4. Set `maxResults` to `3` and `maxPagesPerQuery` to `1`.
5. Keep the proxy disabled for this first example.
6. Run the Actor.
7. Show the dataset fields: `title`, `brand`, `price`, `mrp`, `discountPercent`, `rating`, `inStock`, and `productUrl`.
8. Export the dataset as CSV or Excel.
9. Closing line: "Schedule the same input to monitor public price, discount, and stock changes over time."

## Short Post Copy

I polished an India E-commerce Price Tracker on Apify.

It collects public product-level data across Flipkart, Myntra, BigBasket, Blinkit, JioMart, Meesho, and AliExpress into one normalized dataset for price monitoring, competitor research, and assortment analysis.

The output includes source, search query, product ID, title, brand, current price, MRP, discount percentage, currency, size or variant, category, aggregate rating, rating count, stock signal, product URL, image URL, and scrape timestamp.

It intentionally avoids seller contacts, reviewer identities, emails, phone numbers, and other personal data.

Example input:

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

## SEO Keywords

- India ecommerce price scraper
- Flipkart Myntra Meesho price tracker
- Indian marketplace price monitoring
- ecommerce competitor price data
- product discount tracker India
- quick commerce price scraper
- Apify ecommerce scraper

## Promotion Guard

Use only real product-level outputs. Do not position the Actor as a seller-contact scraper, reviewer scraper, lead-generation tool, or guaranteed source-availability service. Explain that marketplace layouts, blocking, and location-specific inventory can change.
