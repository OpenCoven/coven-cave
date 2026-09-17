/**
 * Durable store for the Research desk's saved links (cave-avrt).
 *
 * One JSON file beside Cave's other local state. Links arrive from the chat
 * `/save` (alias `/link`) command or the desk's Links shelf, get categorized
 * and titled by the pure link-organizer, and are deduped on a normalized URL
 * so re-saving the same page refreshes nothing and creates nothing.
 */

import { randomUUID } from "node:crypto";

import {
  categorizeLink,
  deriveLinkTitle,
  MAX_LINKS_PER_SAVE,
  savedLinkDedupeKey,
  type SavedLink,
  type SavedLinkSummary,
} from "../link-organizer.ts";
import { arxivIdFromUrl } from "../hf-papers.ts";
import {
  normalizeGithubRepoSnapshot,
  type GithubRepoSnapshot,
} from "../research-github-repo.ts";
import {
  MAX_X_ARTICLE_BODY_CHARS,
  MAX_X_ARTICLE_EXCERPT_CHARS,
  isValidXArticleAuthorDisplayName,
  isValidXArticleAuthorId,
  isValidXArticleContentSha256,
  isValidXArticleSourcePostId,
  isValidXArticleUsername,
  normalizeXArticleCoverImageUrl,
  normalizeXArticleTimestamp,
  parseXArticleCandidateUrl,
  type XArticleSnapshot,
  xArticleCodePointLength,
} from "../x-articles.ts";
import type { HfPaperMetadata } from "./hf-paper-metadata.ts";
import {
  listCompatibleResearchLinks,
  mutateCompatibleResearchLinks,
} from "./research-links-compatibility.ts";
import { xArticleContentSha256 } from "./x-article-content-sha.ts";

export { MAX_LINKS_PER_SAVE };

export const MAX_SAVED_LINKS = 10_000;

type UnknownRecord = Record<string, unknown>;

export type ResearchLinkEnrichment = {
  paper?: HfPaperMetadata;
  xArticle?: {
    title: string;
    snapshot: XArticleSnapshot;
  };
  githubRepo?: GithubRepoSnapshot;
};

type LegacyResearchLinkEnrichment = HfPaperMetadata | null;
type ResearchLinkEnrichmentInput = ResearchLinkEnrichment | LegacyResearchLinkEnrichment;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeXArticleBlock(value: unknown, rawUrl: string): XArticleSnapshot | undefined {
  if (!isRecord(value)) return undefined;

  const candidate = parseXArticleCandidateUrl(rawUrl);
  const sourcePostId = value.sourcePostId;
  const body = typeof value.body === "string" ? value.body.trim() : null;
  if (
    candidate === null
    || !isValidXArticleSourcePostId(sourcePostId)
    || candidate.sourcePostId !== sourcePostId
    || value.version !== 1
    || value.provider !== "sorsa"
    || (value.titleSource !== "provider" && value.titleSource !== "derived")
    || !isRecord(value.author)
    || !isValidXArticleAuthorId(value.author.id)
    || !isValidXArticleUsername(value.author.username)
    || body === null
    || body.length === 0
    || xArticleCodePointLength(body) > MAX_X_ARTICLE_BODY_CHARS
    || typeof value.excerpt !== "string"
    || xArticleCodePointLength(value.excerpt) > MAX_X_ARTICLE_EXCERPT_CHARS
    || !isValidXArticleContentSha256(value.contentSha256)
  ) {
    return undefined;
  }
  if (xArticleContentSha256(body) !== value.contentSha256) return undefined;

  const coverImageUrl = normalizeXArticleCoverImageUrl(value.coverImageUrl);
  if (coverImageUrl === null) return undefined;

  const publishedAt = normalizeXArticleTimestamp(value.publishedAt);
  const fetchedAt = normalizeXArticleTimestamp(value.fetchedAt);
  if (!publishedAt || !fetchedAt) return undefined;

  const displayName = value.author.displayName;
  if (displayName !== undefined) {
    if (
      !isValidXArticleAuthorDisplayName(displayName)
    ) {
      return undefined;
    }
  }

  return {
    version: 1,
    provider: "sorsa",
    sourcePostId,
    titleSource: value.titleSource,
    author: {
      id: value.author.id,
      username: value.author.username,
      ...(displayName === undefined ? {} : { displayName }),
    },
    body,
    excerpt: value.excerpt,
    ...(coverImageUrl === undefined ? {} : { coverImageUrl }),
    publishedAt,
    fetchedAt,
    contentSha256: value.contentSha256,
  };
}

/**
 * This is the trust boundary for a user-editable file on disk, so it must
 * bound every field it accepts, not just type-check it — an unbounded field
 * here (e.g. a hostile or accidentally-huge upstream response, see
 * `hf-paper-metadata.ts`) would otherwise land verbatim in the store and be
 * rendered in the resource row (cave-gnvfa). Bounds are generous relative to
 * a real arXiv paper; anything past them drops the whole block, same as any
 * other malformed input here.
 */
const MAX_HF_PAPER_TITLE_CHARS = 1_000;
const MAX_HF_PAPER_ABSTRACT_CHARS = 20_000;
const MAX_HF_PAPER_PUBLISHED_AT_CHARS = 64;
const MAX_HF_PAPER_AUTHORS = 500;
const MAX_HF_PAPER_AUTHOR_NAME_CHARS = 200;

function isHfPaperMetadata(value: unknown): value is HfPaperMetadata {
  return isRecord(value)
    && typeof value.title === "string"
    && value.title.length <= MAX_HF_PAPER_TITLE_CHARS
    && Array.isArray(value.authors)
    && value.authors.length <= MAX_HF_PAPER_AUTHORS
    && value.authors.every(
      (author) => typeof author === "string" && author.length <= MAX_HF_PAPER_AUTHOR_NAME_CHARS,
    )
    && typeof value.abstract === "string"
    && value.abstract.length <= MAX_HF_PAPER_ABSTRACT_CHARS
    && typeof value.publishedAt === "string"
    && value.publishedAt.length <= MAX_HF_PAPER_PUBLISHED_AT_CHARS;
}

function normalizeResearchLinkEnrichment(
  value: ResearchLinkEnrichmentInput | undefined,
): ResearchLinkEnrichment | undefined {
  if (!isRecord(value)) return undefined;
  if (!("paper" in value || "xArticle" in value || "githubRepo" in value)) {
    return isHfPaperMetadata(value) ? { paper: value } : undefined;
  }

  const paper = isHfPaperMetadata(value.paper) ? value.paper : undefined;
  const xArticle = isRecord(value.xArticle)
    && typeof value.xArticle.title === "string"
    && value.xArticle.title.trim().length > 0
    && isRecord(value.xArticle.snapshot)
      ? {
          title: value.xArticle.title,
          snapshot: value.xArticle.snapshot as XArticleSnapshot,
        }
      : undefined;
  const githubRepo = normalizeGithubRepoSnapshot(value.githubRepo) ?? undefined;

  return paper || xArticle || githubRepo
    ? {
        ...(paper ? { paper } : {}),
        ...(xArticle ? { xArticle } : {}),
        ...(githubRepo ? { githubRepo } : {}),
      }
    : undefined;
}

let writeMutex: Promise<unknown> = Promise.resolve();
function withWriteMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeMutex.then(fn, fn);
  writeMutex = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

const xArticleReservations = new Set<string>();

export type XArticleCandidateReservation = {
  /** The first submitted URL for each identity this request may resolve. */
  reservedUrls: readonly string[];
  /** Unsaved X status identities held by this request until release. */
  reservedIdentities: ReadonlySet<string>;
  /** X status identities already present in normalized persisted links. */
  existingIdentities: ReadonlySet<string>;
  /** X status identities another in-flight request is resolving. */
  contendedIdentities: ReadonlySet<string>;
  /** Idempotently return this request's identities to the process-local pool. */
  release(): Promise<void>;
};

/**
 * Atomically read the normalized store and reserve unsaved X status identities.
 *
 * The queue only protects the short read-and-reserve transition; callers must
 * resolve providers after this returns and release in a finally block.
 */
export async function reserveXArticleCandidates(
  rawUrls: readonly string[],
): Promise<XArticleCandidateReservation> {
  return withWriteMutex(async () => {
    const links = await listCompatibleResearchLinks();
    const persistedIdentities = new Set(links.map((link) => savedLinkDedupeKey(link.url)));
    const seen = new Set<string>();
    const reservedUrls: string[] = [];
    const reservedIdentities = new Set<string>();
    const existingIdentities = new Set<string>();
    const contendedIdentities = new Set<string>();

    for (const rawUrl of rawUrls) {
      const url = rawUrl.trim();
      if (!parseXArticleCandidateUrl(url)) continue;
      const identity = savedLinkDedupeKey(url);
      if (seen.has(identity)) continue;
      seen.add(identity);

      if (persistedIdentities.has(identity)) {
        existingIdentities.add(identity);
      } else if (xArticleReservations.has(identity)) {
        contendedIdentities.add(identity);
      } else {
        xArticleReservations.add(identity);
        reservedIdentities.add(identity);
        reservedUrls.push(url);
      }
    }

    let releasePromise: Promise<void> | undefined;
    return {
      reservedUrls,
      reservedIdentities,
      existingIdentities,
      contendedIdentities,
      release() {
        releasePromise ??= withWriteMutex(async () => {
          for (const identity of reservedIdentities) xArticleReservations.delete(identity);
        });
        return releasePromise;
      },
    };
  });
}

/** Newest first. */
export async function listSavedLinks(): Promise<SavedLink[]> {
  return listCompatibleResearchLinks();
}

export function toSavedLinkSummary(link: SavedLink): SavedLinkSummary {
  const { xArticle: fullXArticle, githubRepo: fullGithubRepo, ...rest } = link;
  const xArticle = fullXArticle
    ? (({ body: _body, ...summary }) => summary)(fullXArticle)
    : undefined;
  const githubRepo = fullGithubRepo
    ? (({ tree: _tree, readme: _readme, ...summary }) => summary)(fullGithubRepo)
    : undefined;
  return {
    ...rest,
    ...(xArticle ? { xArticle } : {}),
    ...(githubRepo ? { githubRepo } : {}),
  };
}

export async function listSavedLinkSummaries(): Promise<SavedLinkSummary[]> {
  return (await listSavedLinks()).map(toSavedLinkSummary);
}

export async function getSavedLinkById(id: string): Promise<SavedLink | null> {
  const normalizedId = typeof id === "string" ? id.trim() : "";
  if (!normalizedId || normalizedId.length > 128) return null;
  return (await listCompatibleResearchLinks()).find((link) => link.id === normalizedId) ?? null;
}

export type SaveLinksResult = {
  added: SavedLink[];
  /** URLs skipped because an equivalent link is already saved. */
  duplicates: string[];
  /** Inputs that couldn't parse as http(s) URLs. */
  invalid: string[];
};

/** Prepend successful saves and retain exactly the newest bounded catalog. */
export function prependSavedLinksAtCap(
  added: readonly SavedLink[],
  existing: readonly SavedLink[],
  maxSavedLinks = MAX_SAVED_LINKS,
): SavedLink[] {
  if (!Number.isSafeInteger(maxSavedLinks) || maxSavedLinks < 0) {
    throw new RangeError("maxSavedLinks must be a non-negative safe integer");
  }
  return added.length > 0
    ? [...added, ...existing].slice(0, maxSavedLinks)
    : [...existing];
}

/** Save many at once — the desk shelf accepts a whole pasted block. */
export async function saveResearchLinks(
  rawUrls: string[],
  source: SavedLink["source"],
  enrichment?: Map<string, ResearchLinkEnrichment>,
): Promise<SaveLinksResult>;
export async function saveResearchLinks(
  rawUrls: string[],
  source: SavedLink["source"],
  enrichment?: Map<string, LegacyResearchLinkEnrichment>,
): Promise<SaveLinksResult>;
export async function saveResearchLinks(
  rawUrls: string[],
  source: SavedLink["source"],
  enrichment?: Map<string, ResearchLinkEnrichmentInput>,
): Promise<SaveLinksResult> {
  return withWriteMutex(async () => {
    return mutateCompatibleResearchLinks((links) => {
      const existing = new Set(links.map((link) => savedLinkDedupeKey(link.url)));
      const added: SavedLink[] = [];
      const duplicates: string[] = [];
      const invalid: string[] = [];

      for (const raw of rawUrls.slice(0, MAX_LINKS_PER_SAVE)) {
        const trimmed = typeof raw === "string" ? raw.trim() : "";
        let parsed: URL;
        try {
          parsed = new URL(trimmed);
        } catch {
          if (trimmed) invalid.push(trimmed);
          continue;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          invalid.push(trimmed);
          continue;
        }
        const key = savedLinkDedupeKey(trimmed);
        if (existing.has(key)) {
          duplicates.push(trimmed);
          continue;
        }
        existing.add(key);
        const normalizedEnrichment = normalizeResearchLinkEnrichment(enrichment?.get(trimmed));
        const normalizedXArticle = normalizeXArticleBlock(normalizedEnrichment?.xArticle?.snapshot, trimmed);
        const arxivId = arxivIdFromUrl(trimmed);
        const paper = normalizedEnrichment?.paper && arxivId
          ? {
              arxivId,
              authors: normalizedEnrichment.paper.authors,
              abstract: normalizedEnrichment.paper.abstract,
              publishedAt: normalizedEnrichment.paper.publishedAt,
            }
          : undefined;
        added.push({
          id: randomUUID(),
          url: trimmed,
          category: normalizedXArticle ? "article" : categorizeLink(trimmed),
          title:
            (normalizedXArticle ? normalizedEnrichment?.xArticle?.title : normalizedEnrichment?.paper?.title)
            || deriveLinkTitle(trimmed),
          addedAt: "",
          source,
          ...(paper ? { paper } : {}),
          ...(normalizedXArticle ? { xArticle: normalizedXArticle } : {}),
          ...(normalizedEnrichment?.githubRepo
            ? { githubRepo: normalizedEnrichment.githubRepo }
            : {}),
        });
      }

      // The authoritative catalog sorts equal timestamps by id, so UUIDs
      // cannot serve as the ordering channel for one saved batch. Give every
      // accepted row a distinct timestamp, newest-first in request order, and
      // keep the whole batch newer than the existing head.
      const newestExistingMs = links.reduce(
        (latest, link) => Math.max(latest, Date.parse(link.addedAt)),
        Number.NEGATIVE_INFINITY,
      );
      const firstAddedAtMs = Math.max(Date.now(), newestExistingMs + added.length);
      for (const [index, link] of added.entries()) {
        link.addedAt = new Date(firstAddedAtMs - index).toISOString();
      }

      return {
        links: prependSavedLinksAtCap(added, links),
        result: { added, duplicates, invalid },
      };
    });
  });
}

/** Returns true when a link was actually removed. */
export async function removeSavedLink(id: string): Promise<boolean> {
  return withWriteMutex(async () => {
    return mutateCompatibleResearchLinks((links) => {
      const next = links.filter((link) => link.id !== id);
      return { links: next, result: next.length !== links.length };
    });
  });
}
