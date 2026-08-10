/**
 * search-ranking — the deterministic ranker behind global search (cave-ychtl.4).
 *
 * Determinism is the requirement, not a nicety: the same query against the same
 * corpus must produce the same order every time, or the golden tests below
 * cannot exist and a user cannot learn where things appear.
 *
 * The spec fixes the order of evidence, and this file implements exactly that
 * list rather than a tuned score:
 *
 *   1. exact normalized title
 *   2. exact quoted phrase
 *   3. title prefix, then title token
 *   4. bounded fuzzy title
 *   5. FTS relevance across title, body and tags
 *   6. recency and actionable status
 *   7. former-current-context boost after explicit global broadening
 *
 * Two rules exist because their absence produced specific bad behavior:
 * an exact title match must never lose to a newer body-only match, and
 * provider scores are normalized before merging so a provider cannot dominate
 * merely because its native scale is larger.
 *
 * Spec: docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md
 */

import type { SearchDocument, SearchMatchReason } from "./search-document.ts";

/** Evidence tiers, highest first. A higher tier always outranks a lower one. */
export const EVIDENCE_TIERS = [
  "exact-title",
  "phrase",
  "title-prefix",
  "title-token",
  "fuzzy-title",
  "text",
] as const;

export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

const TIER_RANK: ReadonlyMap<string, number> = new Map(
  EVIDENCE_TIERS.map((tier, index) => [tier, EVIDENCE_TIERS.length - index]),
);

export type RankableResult = {
  document: SearchDocument;
  /** Provider-native relevance, on whatever scale that provider uses. */
  relevance: number;
  providerId: string;
  stale?: boolean;
};

export type RankedResult = RankableResult & {
  reasons: SearchMatchReason[];
  tier: EvidenceTier;
  /** Normalized 0..1 relevance, comparable across providers. */
  normalized: number;
  score: number;
};

export type RankOptions = {
  text: string;
  phrases: string[];
  /** Instant used for recency. Passed in so ranking stays clock-free. */
  now: number;
  /**
   * Scopes that WERE implicit before the user broadened globally. Documents
   * matching them get a small boost — enough to keep local work near the top,
   * never enough to outrank a better tier.
   */
  formerContextProjectIds?: string[];
  formerContextFamiliarIds?: string[];
};

const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** Cheap bounded edit distance: returns false as soon as it exceeds `max`. */
export function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    // Every future row can only grow, so bail once the whole row exceeds max.
    if (rowMin > max) return false;
    previous = current;
  }
  return previous[b.length]! <= max;
}

/**
 * Classify how a document matched, highest tier wins.
 *
 * Returns the tier plus every reason that applied, because the spec requires a
 * result to be able to explain itself and the tests assert on reasons rather
 * than on a numeric score.
 */
export function classifyMatch(
  document: SearchDocument,
  options: Pick<RankOptions, "text" | "phrases">,
): { tier: EvidenceTier; reasons: SearchMatchReason[] } {
  const title = normalizeText(document.title);
  const query = normalizeText(options.text);
  const reasons: SearchMatchReason[] = [];

  if (query.length > 0 && title === query) reasons.push("exact-title");

  const haystack = `${title} ${normalizeText(document.body)} ${document.tags.join(" ").toLowerCase()}`;
  for (const phrase of options.phrases) {
    const needle = normalizeText(phrase);
    if (needle.length > 0 && haystack.includes(needle)) {
      reasons.push("phrase");
      break;
    }
  }

  if (query.length > 0) {
    if (title.startsWith(query)) reasons.push("title-prefix");
    else if (title.split(" ").includes(query)) reasons.push("title-token");
    // Fuzzy is deliberately last and bounded: it runs only on the title, only
    // for queries long enough to be meaningful, and only within one edit.
    else if (query.length >= 4 && withinEditDistance(title, query, 1)) {
      reasons.push("fuzzy-title");
    }
  }

  if (reasons.length === 0) reasons.push("text");

  const tier = EVIDENCE_TIERS.find((candidate) => reasons.includes(candidate)) ?? "text";
  return { tier, reasons };
}

/**
 * Normalize provider-native relevance to 0..1 WITHIN each provider.
 *
 * Without this a provider whose scores run 0..100 buries one whose scores run
 * 0..1, purely because of scale. Normalizing per provider means the merge
 * compares "how good for its own corpus", which is the only comparable thing.
 *
 * A provider returning a single result, or a flat set, normalizes to 1 rather
 * than 0 — its one result is its best result.
 */
export function normalizeByProvider(results: readonly RankableResult[]): Map<string, number> {
  const byProvider = new Map<string, { min: number; max: number }>();
  for (const result of results) {
    const range = byProvider.get(result.providerId);
    if (!range) byProvider.set(result.providerId, { min: result.relevance, max: result.relevance });
    else {
      range.min = Math.min(range.min, result.relevance);
      range.max = Math.max(range.max, result.relevance);
    }
  }
  const normalized = new Map<string, number>();
  for (const [providerId, range] of byProvider) {
    normalized.set(providerId, range.max - range.min);
  }
  return normalized;
}

const recencyScore = (document: SearchDocument, now: number): number => {
  const stamp = document.updatedAt ?? document.createdAt;
  if (!stamp) return 0;
  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) return 0;
  const ageDays = Math.max(0, (now - parsed) / 86_400_000);
  // Decays to ~0 over a month; deliberately small next to a tier difference.
  return 1 / (1 + ageDays / 30);
};

const ACTIONABLE = new Set(["blocked", "failed", "in_progress", "running", "open"]);

/**
 * Rank results deterministically.
 *
 * Tier dominates. Everything below it — FTS relevance, recency, actionability,
 * the former-context boost — only ever reorders WITHIN a tier. That is what
 * makes "an exact title match never loses to a newer body-only match" true by
 * construction rather than by weight tuning.
 */
export function rankResults(
  results: readonly RankableResult[],
  options: RankOptions,
): RankedResult[] {
  const spans = normalizeByProvider(results);
  const mins = new Map<string, number>();
  for (const result of results) {
    const current = mins.get(result.providerId);
    if (current === undefined || result.relevance < current) mins.set(result.providerId, result.relevance);
  }

  const formerProjects = new Set(options.formerContextProjectIds ?? []);
  const formerFamiliars = new Set(options.formerContextFamiliarIds ?? []);

  const ranked = results.map((result) => {
    const { tier, reasons } = classifyMatch(result.document, options);
    const span = spans.get(result.providerId) ?? 0;
    const min = mins.get(result.providerId) ?? 0;
    const normalized = span === 0 ? 1 : (result.relevance - min) / span;

    const contextBoost =
      (result.document.projectId && formerProjects.has(result.document.projectId)) ||
      (result.document.familiarId && formerFamiliars.has(result.document.familiarId))
        ? 1
        : 0;
    const actionable = result.document.status && ACTIONABLE.has(result.document.status) ? 1 : 0;

    // Weights are ordered so no lower term can ever cross a tier boundary:
    // the tier contributes at least 1000, everything else sums to well under it.
    const score =
      (TIER_RANK.get(tier) ?? 0) * 1000 +
      normalized * 100 +
      contextBoost * 10 +
      actionable * 5 +
      recencyScore(result.document, options.now) * 4;

    return { ...result, reasons, tier, normalized, score };
  });

  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tiebreak, so equal scores never reorder between runs.
    if (a.providerId !== b.providerId) return a.providerId < b.providerId ? -1 : 1;
    return a.document.id < b.document.id ? -1 : 1;
  });
}

/**
 * Interleave for "top" presentation with a per-type diversity floor.
 *
 * Pure score order lets one entity type fill the whole first page. The floor
 * guarantees each represented type at least one slot before any type takes a
 * second, then score order resumes.
 */
export function interleaveByType(results: readonly RankedResult[], limit: number): RankedResult[] {
  const seen = new Set<string>();
  const first: RankedResult[] = [];
  const rest: RankedResult[] = [];
  for (const result of results) {
    if (!seen.has(result.document.entityType)) {
      seen.add(result.document.entityType);
      first.push(result);
    } else rest.push(result);
  }
  return [...first, ...rest].slice(0, Math.max(0, limit));
}

/**
 * Drop duplicates, keeping the best-ranked copy.
 *
 * Identity is `providerId + id`, matching the index. Two providers legitimately
 * describing the same underlying thing are NOT merged here — that would require
 * cross-provider identity the contracts do not define.
 */
export function dedupeResults(results: readonly RankedResult[]): RankedResult[] {
  const seen = new Set<string>();
  const out: RankedResult[] = [];
  for (const result of results) {
    const key = `${result.providerId}\0${result.document.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}

/** Group and facet counts, computed from the ranked set the caller will see. */
export function facetCounts(results: readonly RankedResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    counts[result.document.entityType] = (counts[result.document.entityType] ?? 0) + 1;
  }
  return counts;
}
