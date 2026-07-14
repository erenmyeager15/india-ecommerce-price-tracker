import type { SourceName } from './types.js';

export type SourceOutcome = 'results' | 'empty' | 'failed' | 'not_run';

export interface SourceRunStatus {
  source: SourceName;
  outcome: SourceOutcome;
  candidates: number;
  saved: number;
  durationMillis: number;
  error?: string;
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@')
    .replace(/([?&](?:api[_-]?key|key|token|signature|password)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || 'Unknown source error';
}

export function buildSourceStatusDocument(
  statuses: SourceRunStatus[],
  savedRecords: number,
  spendingLimitReached: boolean,
): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    savedRecords,
    spendingLimitReached,
    sources: statuses,
  };
}

export function noResultsError(statuses: SourceRunStatus[]): Error {
  const details = statuses.map((status) => {
    if (status.outcome === 'failed') return `${status.source}: failed (${status.error ?? 'unknown error'})`;
    return `${status.source}: ${status.outcome} (${status.candidates} candidates, ${status.saved} saved)`;
  }).join('; ');
  return new Error(`India E-commerce Price Tracker finished with no saved products. Source outcomes: ${details}`);
}
