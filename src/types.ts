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

export interface ProductTargetInput {
  name?: string;
  brand?: string;
  packSize?: string;
  variant?: string;
}

export interface ProductTarget {
  name: string;
  brand: string | null;
  packSize: string | null;
  variant: string | null;
  searchQuery: string;
}

export type MatchConfidence = 'exact' | 'high' | 'likely' | 'needs_review';

export interface ActorInput {
  sources?: SourceName[];
  searchQueries?: string[];
  targetProducts?: ProductTargetInput[];
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
  targetProducts: ProductTarget[];
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
  source: string;
  searchQuery: string;
  targetProduct: string;
  matchConfidence: MatchConfidence;
  matchScore: number;
  matchReason: string;
  position: number | null;
  productId: string | null;
  title: string;
  brand: string;
  price: number | null;
  mrp: number | null;
  discountPercent: number | null;
  currency: string;
  packSize: string;
  category: string;
  rating: number | null;
  ratingCount: number | null;
  inStock: boolean | null;
  productUrl: string | null;
  imageUrl: string | null;
  scrapedAt: string;
}

export interface SourceContext {
  input: NormalizedInput;
  maxResults: number;
  maxResultsPerQuery?: number;
  proxyConfiguration?: {
    newUrl(sessionId?: string): Promise<string | undefined>;
  };
}

export type SourceRunner = (context: SourceContext) => Promise<ProductRecord[]>;
