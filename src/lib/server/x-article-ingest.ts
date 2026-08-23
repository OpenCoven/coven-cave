import { savedLinkDedupeKey } from "../link-organizer.ts";
import {
  MAX_X_ARTICLES_PER_INGEST,
  XArticleProviderError,
  parseXArticleCandidateUrl,
  type XArticleIngestFailure,
} from "../x-articles.ts";
import {
  configuredXArticleProvider,
  type XArticleProvider,
} from "./x-article-provider.ts";
import type { ResearchLinkEnrichment } from "./research-links.ts";

export const MAX_X_ARTICLE_INGEST_CONCURRENCY = 3;

export class XArticleIngestCapError extends Error {
  readonly limit = MAX_X_ARTICLES_PER_INGEST;

  constructor() {
    super(`too many X Articles in one save (max ${MAX_X_ARTICLES_PER_INGEST})`);
    this.name = "XArticleIngestCapError";
  }
}

export type XArticleBatchResult = {
  enrichments: Map<string, ResearchLinkEnrichment>;
  failures: XArticleIngestFailure[];
};

export type XArticleIngestDependencies = {
  provider?: XArticleProvider;
  providerFactory?: () => XArticleProvider;
};

type XArticleCandidate = {
  url: string;
  sourcePostId: string;
};

type CandidateOutcome =
  | { enrichment: ResearchLinkEnrichment }
  | { failure: XArticleIngestFailure };

function providerFailure(url: string, error: XArticleProviderError): XArticleIngestFailure {
  return {
    url,
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  };
}

function configuredProvider(dependencies: XArticleIngestDependencies): XArticleProvider {
  return dependencies.provider
    ?? dependencies.providerFactory?.()
    ?? configuredXArticleProvider();
}

function uniqueXArticleCandidates(urls: readonly string[]): XArticleCandidate[] {
  const candidates: XArticleCandidate[] = [];
  const sourcePostIds = new Set<string>();

  for (const rawUrl of urls) {
    const url = rawUrl.trim();
    const parsed = parseXArticleCandidateUrl(url);
    if (!parsed || sourcePostIds.has(parsed.sourcePostId)) continue;
    sourcePostIds.add(parsed.sourcePostId);
    candidates.push({ url, sourcePostId: parsed.sourcePostId });
  }

  return candidates;
}

/** Reject an over-cap X Article batch before any store or network work begins. */
export function assertXArticleIngestCap(urls: readonly string[]): void {
  if (uniqueXArticleCandidates(urls).length > MAX_X_ARTICLES_PER_INGEST) {
    throw new XArticleIngestCapError();
  }
}

/**
 * Bounded best-effort article resolution. Provider failures stay attached to
 * their submitted URL, while unexpected failures still surface to the route.
 */
export async function enrichXArticleUrls(
  urls: readonly string[],
  existingUrls: ReadonlySet<string>,
  dependencies: XArticleIngestDependencies = {},
): Promise<XArticleBatchResult> {
  const candidates = uniqueXArticleCandidates(urls);
  assertXArticleIngestCap(urls);

  const existingKeys = new Set([...existingUrls].map(savedLinkDedupeKey));
  const unsaved = candidates.filter((candidate) => !existingKeys.has(savedLinkDedupeKey(candidate.url)));
  if (unsaved.length === 0) return { enrichments: new Map(), failures: [] };

  let provider: XArticleProvider;
  try {
    provider = configuredProvider(dependencies);
  } catch (error) {
    if (error instanceof XArticleProviderError) {
      return {
        enrichments: new Map(),
        failures: unsaved.map((candidate) => providerFailure(candidate.url, error)),
      };
    }
    throw error;
  }

  const outcomes: Array<CandidateOutcome | undefined> = new Array(unsaved.length);
  let nextCandidateIndex = 0;
  const unexpectedErrors = new Map<number, unknown>();
  let hasUnexpectedError = false;
  const worker = async () => {
    while (!hasUnexpectedError && nextCandidateIndex < unsaved.length) {
      const index = nextCandidateIndex++;
      const candidate = unsaved[index];
      try {
        const article = await provider.fetchArticle(candidate.url);
        const { title, ...snapshot } = article;
        outcomes[index] = {
          enrichment: {
            xArticle: {
              title,
              snapshot: { version: 1, ...snapshot },
            },
          },
        };
      } catch (error) {
        if (error instanceof XArticleProviderError) {
          outcomes[index] = { failure: providerFailure(candidate.url, error) };
          continue;
        }
        unexpectedErrors.set(index, error);
        hasUnexpectedError = true;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_X_ARTICLE_INGEST_CONCURRENCY, unsaved.length) },
      () => worker(),
    ),
  );
  if (hasUnexpectedError) {
    const firstUnexpectedIndex = Math.min(...unexpectedErrors.keys());
    throw unexpectedErrors.get(firstUnexpectedIndex);
  }

  const enrichments = new Map<string, ResearchLinkEnrichment>();
  const failures: XArticleIngestFailure[] = [];
  for (let index = 0; index < unsaved.length; index++) {
    const outcome = outcomes[index];
    if (!outcome) continue;
    if ("enrichment" in outcome) enrichments.set(unsaved[index].url, outcome.enrichment);
    else failures.push(outcome.failure);
  }
  return { enrichments, failures };
}
