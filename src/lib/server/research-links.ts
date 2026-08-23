/**
 * Durable store for the Research desk's saved links (cave-avrt).
 *
 * One JSON file beside Cave's other local state. Links arrive from the chat
 * `/save` (alias `/link`) command or the desk's Links shelf, get categorized
 * and titled by the pure link-organizer, and are deduped on a normalized URL
 * so re-saving the same page refreshes nothing and creates nothing.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  categorizeLink,
  deriveLinkTitle,
  LINK_CATEGORY_ORDER,
  MAX_LINKS_PER_SAVE,
  savedLinkDedupeKey,
  type LinkCategory,
  type SavedLink,
  type SavedLinkSummary,
} from "../link-organizer.ts";
import { caveHome } from "../coven-paths.ts";
import { arxivIdFromUrl, isArxivPaperId } from "../hf-papers.ts";
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
import { corruptAsidePath } from "./corrupt-aside.ts";
import { writeJsonAtomic } from "./atomic-write.ts";
import type { HfPaperMetadata } from "./hf-paper-metadata.ts";
import { xArticleContentSha256 } from "./x-article-content-sha.ts";

export { MAX_LINKS_PER_SAVE };

export const MAX_SAVED_LINKS = 500;

type UnknownRecord = Record<string, unknown>;

type ResearchLinksFile = {
  version: 1;
  links: SavedLink[];
};

export type ResearchLinkEnrichment = {
  paper?: HfPaperMetadata;
  xArticle?: {
    title: string;
    snapshot: XArticleSnapshot;
  };
};

type LegacyResearchLinkEnrichment = HfPaperMetadata | null;
type ResearchLinkEnrichmentInput = ResearchLinkEnrichment | LegacyResearchLinkEnrichment;

export function researchLinksPath(): string {
  const override = process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE?.trim();
  // Saved links are runtime user data beneath Cave home, never build inputs.
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "research-links.json");
}

function emptyFile(): ResearchLinksFile {
  return { version: 1, links: [] };
}

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

function isValidStoredCategory(value: unknown): value is LinkCategory {
  return typeof value === "string" && LINK_CATEGORY_ORDER.includes(value as LinkCategory);
}

function storedBaseCategory(rawCategory: unknown, url: string): LinkCategory {
  return isValidStoredCategory(rawCategory) ? rawCategory : categorizeLink(url);
}

function isHfPaperMetadata(value: unknown): value is HfPaperMetadata {
  return isRecord(value)
    && typeof value.title === "string"
    && Array.isArray(value.authors)
    && value.authors.every((author) => typeof author === "string")
    && typeof value.abstract === "string"
    && typeof value.publishedAt === "string";
}

function normalizeResearchLinkEnrichment(
  value: ResearchLinkEnrichmentInput | undefined,
): ResearchLinkEnrichment | undefined {
  if (!isRecord(value)) return undefined;
  if (!("paper" in value || "xArticle" in value)) {
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

  return paper || xArticle
    ? {
        ...(paper ? { paper } : {}),
        ...(xArticle ? { xArticle } : {}),
      }
    : undefined;
}

function normalizePaperBlock(value: unknown): SavedLink["paper"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  // Disk contents are user-editable, and arxivId is interpolated into a URL by
  // the PDF route — validate it here rather than trusting the file.
  if (typeof raw.arxivId !== "string" || !isArxivPaperId(raw.arxivId)) return undefined;
  if (!Array.isArray(raw.authors) || !raw.authors.every((a) => typeof a === "string")) return undefined;
  if (typeof raw.abstract !== "string") return undefined;
  if (typeof raw.publishedAt !== "string") return undefined;
  return {
    arxivId: raw.arxivId,
    authors: raw.authors as string[],
    abstract: raw.abstract,
    publishedAt: raw.publishedAt,
  };
}

function normalizeStoredLink(value: unknown): SavedLink | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SavedLink> & { xArticle?: unknown };
  if (typeof raw.url !== "string" || !raw.url) return null;
  // Disk contents are user-editable: unknown categories would silently drop
  // out of the grouped shelves, and unparsable timestamps would scramble the
  // newest-first sort — re-derive both instead of trusting them.
  const categorizedUrl = categorizeLink(raw.url);
  const xArticle = normalizeXArticleBlock(raw.xArticle, raw.url);
  const baseCategory = storedBaseCategory(raw.category, raw.url);
  const category = xArticle
    ? "article"
    : baseCategory === "article" && parseXArticleCandidateUrl(raw.url)
      ? categorizedUrl
      : baseCategory;
  const addedAt =
    typeof raw.addedAt === "string" && Number.isFinite(Date.parse(raw.addedAt))
      ? raw.addedAt
      : new Date().toISOString();
  const paper = normalizePaperBlock((value as { paper?: unknown }).paper);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
    url: raw.url,
    category,
    title: typeof raw.title === "string" && raw.title ? raw.title : deriveLinkTitle(raw.url),
    addedAt,
    source: raw.source === "desk" ? "desk" : "chat",
    ...(paper ? { paper } : {}),
    ...(xArticle ? { xArticle } : {}),
  };
}

async function loadFile(): Promise<ResearchLinksFile> {
  let text: string;
  try {
    text = await readFile(/* turbopackIgnore: true */ researchLinksPath(), "utf8");
  } catch (error) {
    // Only a missing file means "empty store". Transient read failures
    // (EACCES/EMFILE/EIO) must surface — otherwise the next save would
    // read-modify-write an empty result and silently wipe every saved link.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  }
  let parsed: Partial<ResearchLinksFile>;
  try {
    parsed = JSON.parse(text) as Partial<ResearchLinksFile>;
  } catch {
    // Hand-edited into invalid JSON: preserve the malformed bytes beside the
    // store (preferences-store pattern) before any rewrite can replace them.
    await preserveMalformedFile();
    return emptyFile();
  }
  const links = Array.isArray(parsed?.links)
    ? parsed.links.map(normalizeStoredLink).filter((link): link is SavedLink => link !== null)
    : [];
  return { version: 1, links };
}

async function preserveMalformedFile(): Promise<void> {
  const source = researchLinksPath();
  await copyFile(/* turbopackIgnore: true */ source, corruptAsidePath(source)).catch(() => {});
}

async function saveFile(file: ResearchLinksFile): Promise<void> {
  const target = researchLinksPath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
  await writeJsonAtomic(/* turbopackIgnore: true */ target, file);
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
    const file = await loadFile();
    const persistedIdentities = new Set(file.links.map((link) => savedLinkDedupeKey(link.url)));
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
  const file = await loadFile();
  return [...file.links].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export function toSavedLinkSummary(link: SavedLink): SavedLinkSummary {
  if (!link.xArticle) return { ...link };
  const { body: _body, ...xArticle } = link.xArticle;
  return {
    ...link,
    xArticle,
  };
}

export async function listSavedLinkSummaries(): Promise<SavedLinkSummary[]> {
  return (await listSavedLinks()).map(toSavedLinkSummary);
}

export async function getSavedLinkById(id: string): Promise<SavedLink | null> {
  const normalizedId = typeof id === "string" ? id.trim() : "";
  if (!normalizedId || normalizedId.length > 128) return null;
  const file = await loadFile();
  return file.links.find((link) => link.id === normalizedId) ?? null;
}

export type SaveLinksResult = {
  added: SavedLink[];
  /** URLs skipped because an equivalent link is already saved. */
  duplicates: string[];
  /** Inputs that couldn't parse as http(s) URLs. */
  invalid: string[];
};

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
    const file = await loadFile();
    const existing = new Set(file.links.map((link) => savedLinkDedupeKey(link.url)));
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
      // The saved URL is a URL, so classify it. Scanning it as text would
      // attach a `paper` block to any page whose URL happens to embed one.
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
        addedAt: new Date().toISOString(),
        source,
        ...(paper ? { paper } : {}),
        ...(normalizedXArticle ? { xArticle: normalizedXArticle } : {}),
      });
    }

    if (added.length > 0) {
      file.links = [...added, ...file.links].slice(0, MAX_SAVED_LINKS);
      await saveFile(file);
    }
    return { added, duplicates, invalid };
  });
}

/** Returns true when a link was actually removed. */
export async function removeSavedLink(id: string): Promise<boolean> {
  return withWriteMutex(async () => {
    const file = await loadFile();
    const next = file.links.filter((link) => link.id !== id);
    if (next.length === file.links.length) return false;
    file.links = next;
    await saveFile(file);
    return true;
  });
}
