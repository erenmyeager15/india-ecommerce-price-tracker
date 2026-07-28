export interface PushDataChargeResult {
  chargedCount: number;
  eventChargeLimitReached?: boolean;
}

export interface ProductBillingPreflight {
  isPayPerEvent: boolean;
  eventPriceUsd?: number;
  chargeableProductCount: number;
}

export function wasPushedRecordSaved(result: PushDataChargeResult): boolean {
  return result.chargedCount > 0 || result.eventChargeLimitReached !== true;
}

export function productBillingPreflightIssue(input: ProductBillingPreflight): string | null {
  if (!input.isPayPerEvent) return null;
  if (!Number.isFinite(input.eventPriceUsd) || (input.eventPriceUsd ?? 0) <= 0) {
    return 'The product-scraped event is missing or has no positive price.';
  }
  if (input.chargeableProductCount < 1) {
    return 'The maximum cost per run is too low to save and charge for one product.';
  }
  return null;
}
