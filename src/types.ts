export type SourceName =
  | 'flipkart'
  | 'myntra'
  | 'bigbasket'
  | 'blinkit'
  | 'jiomart'
  | 'meesho'
  | 'aliexpress';

export interface ProxyInput {
  useApifyProxy?: boolean;
  apifyProxyGroups?: string[];
  apifyProxyCountry?: string;
  proxyUrls?: string[];
}

export interface ActorInput {
  sources?: SourceName[];
  searchQueries?: string[];
  city?: string;
  latitude?: number;
  longitude?: number;
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  maxResults?: number;
  maxPagesPerQuery?: number;
  proxyConfiguration?: ProxyInput;
}

export interface NormalizedInput {
  sources: SourceName[];
  searchQueries: string[];
  city: string;
  latitude: number;
  longitude: number;
  brands: Set<string>;
  minPrice: number;
  maxPrice: number;
  inStockOnly: boolean;
  maxResults: number;
  maxPagesPerQuery: number;
  proxyConfiguration: ProxyInput;
}

export interface ProductRecord {
  source: SourceName;
  searchQuery: string | null;
  position: number | null;
  productId: string | null;
  title: string | null;
  brand: string | null;
  price: number | null;
  mrp: number | null;
  discountPercent: number | null;
  currency: string | null;
  packSize: string | null;
  category: string | null;
  rating: number | null;
  ratingCount: number | null;
  inStock: boolean | null;
  imageUrl: string | null;
  productUrl: string | null;
  city: string | null;
  scrapedAt: string;
}

export interface SourceContext {
  input: NormalizedInput;
  maxResults: number;
  proxyConfiguration?: {
    newUrl(sessionId?: string): Promise<string | undefined>;
  };
}

export type SourceRunner = (context: SourceContext) => Promise<ProductRecord[]>;

