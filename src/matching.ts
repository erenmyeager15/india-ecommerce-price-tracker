import type {
  MatchConfidence,
  NormalizedInput,
  ProductRecord,
  ProductTarget,
  ProductTargetInput,
} from './types.js';
import { cleanText, uniqueStrings } from './utils.js';

const STOP_WORDS = new Set(['and', 'for', 'of', 'pack', 'the', 'with']);
const UNIT_TOKENS = new Set(['g', 'kg', 'l', 'ml']);

interface Quantity {
  dimension: 'mass' | 'volume' | 'count';
  amount: number;
  label: string;
}

interface MatchResult {
  targetProduct: string;
  matchConfidence: MatchConfidence;
  matchScore: number;
  matchReason: string;
}

function normalizeComparisonText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:litres?|liters?|ltr)\b/g, 'l')
    .replace(/\b(?:kilograms?|kgs?)\b/g, 'kg')
    .replace(/\b(?:grams?|gms?)\b/g, 'g')
    .replace(/\b(?:millilitres?|milliliters?|mls?)\b/g, 'ml')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalToken(token: string): string {
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function tokens(value: unknown): string[] {
  return normalizeComparisonText(value)
    .split(' ')
    .map(canonicalToken)
    .filter((token) => token && !STOP_WORDS.has(token));
}

function descriptiveTokens(value: unknown, excluded: Set<string> = new Set()): string[] {
  return tokens(value).filter((token) => !excluded.has(token) && !UNIT_TOKENS.has(token) && !/^\d+(?:\.\d+)?$/.test(token));
}

function coverage(required: string[], candidate: Set<string>): { matched: number; total: number; ratio: number } {
  const uniqueRequired = [...new Set(required)];
  const matched = uniqueRequired.filter((token) => candidate.has(token)).length;
  return {
    matched,
    total: uniqueRequired.length,
    ratio: uniqueRequired.length ? matched / uniqueRequired.length : 0,
  };
}

function quantityFrom(value: unknown): Quantity | null {
  const text = normalizeComparisonText(value);
  if (!text) return null;

  const multiplied = text.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|l|ml)\b/);
  if (multiplied) {
    const count = Number(multiplied[1]);
    const amount = Number(multiplied[2]);
    return quantityFor(count * amount, multiplied[3]);
  }

  const measured = text.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml)\b/);
  if (measured) return quantityFor(Number(measured[1]), measured[2]);

  const counted = text.match(/(\d+)\s*(?:count|pc|pcs|piece|pieces|unit|units)\b/);
  if (counted) {
    const amount = Number(counted[1]);
    return { dimension: 'count', amount, label: `${amount} count` };
  }
  return null;
}

function quantityFor(amount: number, unit: string): Quantity {
  if (unit === 'kg') return { dimension: 'mass', amount: amount * 1000, label: `${amount} kg` };
  if (unit === 'g') return { dimension: 'mass', amount, label: `${amount} g` };
  if (unit === 'l') return { dimension: 'volume', amount: amount * 1000, label: `${amount} l` };
  return { dimension: 'volume', amount, label: `${amount} ml` };
}

function quantitiesMatch(left: Quantity, right: Quantity): boolean {
  if (left.dimension !== right.dimension) return false;
  return Math.abs(left.amount - right.amount) <= Math.max(1, left.amount * 0.02);
}

function confidenceFor(score: number, exactIdentity: boolean, hasConflict: boolean): MatchConfidence {
  if (score >= 90 && exactIdentity && !hasConflict) return 'exact';
  if (score >= 75 && !hasConflict) return 'high';
  if (score >= 55) return 'likely';
  return 'needs_review';
}

function scoreProductAgainstTarget(record: ProductRecord, target: ProductTarget): MatchResult {
  const candidateText = `${record.title} ${record.brand} ${record.packSize} ${record.category}`;
  const candidateTokens = new Set(tokens(candidateText));
  const brandTokens = new Set(tokens(target.brand));
  const nameMatch = coverage(descriptiveTokens(target.name, brandTokens), candidateTokens);
  const normalizedTitle = normalizeComparisonText(record.title);
  const normalizedTargetName = normalizeComparisonText(target.name);
  const titleContainsTarget = normalizedTargetName.length >= 4 && normalizedTitle.includes(normalizedTargetName);
  const reasons = [`name ${nameMatch.matched}/${nameMatch.total || 1} terms`];
  let score = Math.round(nameMatch.ratio * 55) + (titleContainsTarget ? 10 : 0);
  let hasConflict = false;
  let brandMatched = target.brand === null;
  let packMatched = target.packSize === null;
  let variantMatched = target.variant === null;

  if (target.brand) {
    const brandMatch = coverage(tokens(target.brand), candidateTokens);
    brandMatched = brandMatch.total > 0 && brandMatch.ratio === 1;
    if (brandMatched) {
      score += 20;
      reasons.push(`brand matched ${target.brand}`);
    } else if (record.brand.toLowerCase() !== 'n/a') {
      score -= 20;
      hasConflict = true;
      reasons.push(`brand conflicts with ${record.brand}`);
    } else {
      reasons.push('brand unavailable');
    }
  }

  const targetQuantity = quantityFrom(target.packSize) ?? quantityFrom(target.name);
  const candidateQuantity = quantityFrom(record.packSize) ?? quantityFrom(record.title);
  if (targetQuantity) {
    packMatched = candidateQuantity !== null && quantitiesMatch(targetQuantity, candidateQuantity);
    if (packMatched) {
      score += 15;
      reasons.push(`pack matched ${targetQuantity.label}`);
    } else if (candidateQuantity) {
      score -= 15;
      hasConflict = true;
      reasons.push(`pack conflicts: ${candidateQuantity.label}`);
    } else {
      reasons.push('pack unavailable');
    }
  }

  if (target.variant) {
    const variantMatch = coverage(descriptiveTokens(target.variant), candidateTokens);
    variantMatched = variantMatch.total > 0 && variantMatch.ratio === 1;
    score += Math.round(variantMatch.ratio * 10);
    reasons.push(`variant ${variantMatch.matched}/${variantMatch.total || 1} terms`);
  }

  score = Math.min(Math.max(score, 0), 100);
  const exactIdentity = titleContainsTarget && nameMatch.ratio === 1 && brandMatched && packMatched && variantMatched;
  return {
    targetProduct: target.name,
    matchConfidence: confidenceFor(score, exactIdentity, hasConflict),
    matchScore: score,
    matchReason: reasons.join('; '),
  };
}

export function normalizeProductTargets(rawTargets: ProductTargetInput[] | undefined, fallbackQueries: string[]): ProductTarget[] {
  const targets = Array.isArray(rawTargets)
    ? rawTargets.slice(0, 5).flatMap((raw): ProductTarget[] => {
      const name = cleanText(raw?.name);
      if (!name) return [];
      const brand = cleanText(raw.brand);
      const packSize = cleanText(raw.packSize);
      const variant = cleanText(raw.variant);
      const normalizedName = normalizeComparisonText(name);
      const details = [brand, packSize, variant]
        .filter((value): value is string => Boolean(value))
        .filter((value) => !normalizedName.includes(normalizeComparisonText(value)));
      const searchQuery = uniqueStrings([name, ...details]).join(' ');
      return [{ name, brand, packSize, variant, searchQuery }];
    })
    : [];

  if (targets.length > 0) return targets;
  return uniqueStrings(fallbackQueries).map((name) => ({ name, brand: null, packSize: null, variant: null, searchQuery: name }));
}

export function applyBestProductMatch(record: ProductRecord, targets: ProductTarget[]): ProductRecord {
  const matches = targets.map((target) => scoreProductAgainstTarget(record, target));
  const best = matches.sort((left, right) => right.matchScore - left.matchScore)[0];
  if (!best) return record;
  return { ...record, ...best };
}

function escapeTable(value: unknown): string {
  return String(value ?? 'N/A').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function priceText(record: ProductRecord): string {
  return record.price === null ? 'N/A' : `${record.currency} ${record.price}`;
}

function stockText(record: ProductRecord): string {
  if (record.inStock === true) return 'In stock';
  if (record.inStock === false) return 'Out of stock';
  return 'Unknown';
}

export function buildComparisonReport(records: ProductRecord[], input: NormalizedInput): string {
  const lines = [
    '# Product Match Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Location: ${input.city} (${input.latitude}, ${input.longitude})`,
    '',
    'Confidence is heuristic. Open the source URL before making a pricing decision.',
  ];

  for (const target of input.targetProducts) {
    const candidates = records
      .filter((record) => record.targetProduct === target.name)
      .sort((left, right) => right.matchScore - left.matchScore);
    const seenSources = new Set<string>();
    const bestBySource = candidates.filter((record) => {
      if (seenSources.has(record.source)) return false;
      seenSources.add(record.source);
      return true;
    });
    lines.push('', `## ${target.name}`, '');
    if (bestBySource.length === 0) {
      lines.push('No candidate was saved for this target.');
      continue;
    }
    lines.push('| Source | Candidate | Price | Stock | Confidence | Score | Match evidence |', '| --- | --- | ---: | --- | --- | ---: | --- |');
    for (const record of bestBySource) {
      const title = record.productUrl ? `[${escapeTable(record.title)}](${record.productUrl})` : escapeTable(record.title);
      lines.push(`| ${escapeTable(record.source)} | ${title} | ${priceText(record)} | ${stockText(record)} | ${record.matchConfidence} | ${record.matchScore} | ${escapeTable(record.matchReason)} |`);
    }
    const priced = bestBySource.filter((record) => record.price !== null && record.currency === bestBySource[0]?.currency);
    if (priced.length >= 2) {
      const sorted = priced.sort((left, right) => (left.price ?? 0) - (right.price ?? 0));
      const lowest = sorted[0];
      const highest = sorted[sorted.length - 1];
      const spread = (highest.price ?? 0) - (lowest.price ?? 0);
      const spreadPercent = lowest.price && lowest.price > 0 ? Math.round((spread / lowest.price) * 10_000) / 100 : null;
      lines.push('', `Observed price spread: ${lowest.currency} ${spread}${spreadPercent === null ? '' : ` (${spreadPercent}%)`} from ${lowest.source} to ${highest.source}.`);
    }
  }

  return `${lines.join('\n')}\n`;
}
