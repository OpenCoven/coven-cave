"use client";

/**
 * Shared saved-links state for the Research Desk tabs.
 *
 * The Prompt tab (quick saves) and the Resources tab both read and mutate the
 * same `/api/research/links` store; this hook is the one client for it so the
 * two tabs stay consistent. Lifted from the original links shelf
 * (research-link-shelf.tsx, cave-avrt) — the chat `/save` command still feeds
 * the same store.
 */

import { useCallback, useEffect, useState } from "react";
import {
  categorizeLink,
  LINK_CATEGORY_ORDER,
  type LinkCategory,
  type SavedLink,
  type SavedLinkSummary,
} from "@/lib/link-organizer";
import {
  isValidXArticleAuthorDisplayName,
  isValidXArticleAuthorId,
  isValidXArticleContentSha256,
  isValidXArticleSourcePostId,
  isValidXArticleUsername,
  normalizeXArticleCoverImageUrl,
  normalizeXArticleTimestamp,
  parseXArticleCandidateUrl,
  type XArticleIngestFailure,
} from "@/lib/x-articles";

export type SaveLinksResult = {
  ok: boolean;
  added: number;
  duplicates: number;
  failed: XArticleIngestFailure[];
  error?: string;
};

type SavedLinkBase = Omit<SavedLink, "paper" | "xArticle">;

const X_ARTICLE_FAILURE_CODES = [
  "not-configured",
  "missing-credential",
  "unauthorized",
  "not-article",
  "rate-limited",
  "timeout",
  "upstream-unavailable",
  "invalid-response",
  "too-large",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isLinkCategory(value: unknown): value is LinkCategory {
  return typeof value === "string" && LINK_CATEGORY_ORDER.some((category) => category === value);
}

function isXArticleFailureCode(value: unknown): value is XArticleIngestFailure["code"] {
  return typeof value === "string" && X_ARTICLE_FAILURE_CODES.some((code) => code === value);
}

function parseLinkBase(value: unknown): SavedLinkBase | null {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || value.id.trim().length === 0
    || !isHttpUrl(value.url)
    || !isLinkCategory(value.category)
    || typeof value.title !== "string"
    || value.title.trim().length === 0
    || typeof value.addedAt !== "string"
    || !Number.isFinite(Date.parse(value.addedAt))
    || (value.source !== "chat" && value.source !== "desk")
  ) {
    return null;
  }
  return {
    id: value.id,
    url: value.url,
    category: value.category,
    title: value.title,
    addedAt: value.addedAt,
    source: value.source,
  };
}

function parsePaper(value: unknown): SavedLink["paper"] | null {
  if (value === undefined) return undefined;
  if (
    !isRecord(value)
    || typeof value.arxivId !== "string"
    || !Array.isArray(value.authors)
    || !value.authors.every((author) => typeof author === "string")
    || typeof value.abstract !== "string"
    || typeof value.publishedAt !== "string"
    || !Number.isFinite(Date.parse(value.publishedAt))
  ) {
    return null;
  }
  return {
    arxivId: value.arxivId,
    authors: value.authors,
    abstract: value.abstract,
    publishedAt: value.publishedAt,
  };
}

function normalizeSavedLinkCategory(
  url: string,
  category: LinkCategory,
  hasXArticle: boolean,
): LinkCategory {
  if (hasXArticle) return "article";
  return category === "article" && parseXArticleCandidateUrl(url) ? categorizeLink(url) : category;
}

function parseXArticleSummary(rawUrl: string, value: unknown): SavedLinkSummary["xArticle"] | undefined {
  if (value === undefined) return undefined;
  const candidate = parseXArticleCandidateUrl(rawUrl);
  if (!candidate) return undefined;
  const publishedAt = normalizeXArticleTimestamp(isRecord(value) ? value.publishedAt : undefined);
  const fetchedAt = normalizeXArticleTimestamp(isRecord(value) ? value.fetchedAt : undefined);
  const coverImageUrl = normalizeXArticleCoverImageUrl(isRecord(value) ? value.coverImageUrl : undefined);
  if (
    !isRecord(value)
    || value.version !== 1
    || value.provider !== "sorsa"
    || !isValidXArticleSourcePostId(value.sourcePostId)
    || candidate.sourcePostId !== value.sourcePostId
    || (value.titleSource !== "provider" && value.titleSource !== "derived")
    || !isRecord(value.author)
    || !isValidXArticleAuthorId(value.author.id)
    || !isValidXArticleUsername(value.author.username)
    || (value.author.displayName !== undefined
      && !isValidXArticleAuthorDisplayName(value.author.displayName))
    || typeof value.excerpt !== "string"
    || !publishedAt
    || !fetchedAt
    || !isValidXArticleContentSha256(value.contentSha256)
    || coverImageUrl === null
  ) {
    return undefined;
  }
  return {
    version: 1,
    provider: "sorsa",
    sourcePostId: value.sourcePostId,
    titleSource: value.titleSource,
    author: {
      id: value.author.id,
      username: value.author.username,
      ...(value.author.displayName === undefined ? {} : { displayName: value.author.displayName }),
    },
    excerpt: value.excerpt,
    ...(coverImageUrl === undefined ? {} : { coverImageUrl }),
    publishedAt,
    fetchedAt,
    contentSha256: value.contentSha256,
  };
}

function parseSavedLinkSummary(value: unknown): SavedLinkSummary | null {
  const base = parseLinkBase(value);
  if (!base || !isRecord(value)) return null;
  const paper = parsePaper(value.paper);
  const xArticle = parseXArticleSummary(base.url, value.xArticle);
  if (paper === null) return null;
  return {
    ...base,
    category: normalizeSavedLinkCategory(base.url, base.category, Boolean(xArticle)),
    ...(paper ? { paper } : {}),
    ...(xArticle ? { xArticle } : {}),
  };
}

function parseSavedLink(value: unknown): SavedLink | null {
  const summary = parseSavedLinkSummary(value);
  if (!summary || !isRecord(value)) return null;
  const base: SavedLink = {
    id: summary.id,
    url: summary.url,
    category: summary.category,
    title: summary.title,
    addedAt: summary.addedAt,
    source: summary.source,
    ...(summary.paper ? { paper: summary.paper } : {}),
  };
  if (!summary.xArticle) {
    return base;
  }
  const body = isRecord(value.xArticle) && typeof value.xArticle.body === "string"
    ? value.xArticle.body.trim()
    : null;
  if (!body) return base;
  return {
    ...base,
    xArticle: {
      ...summary.xArticle,
      body,
    },
  };
}

export const parseSavedLinkSummaryForTests = parseSavedLinkSummary;
export const parseSavedLinkForTests = parseSavedLink;

function parseFailure(value: unknown): XArticleIngestFailure | null {
  if (
    !isRecord(value)
    || !isHttpUrl(value.url)
    || !isXArticleFailureCode(value.code)
    || typeof value.message !== "string"
    || value.message.trim().length === 0
    || typeof value.retryable !== "boolean"
  ) {
    return null;
  }
  return {
    url: value.url,
    code: value.code,
    message: value.message,
    retryable: value.retryable,
  };
}

function responseError(data: unknown, fallback: string): string {
  return isRecord(data) && typeof data.error === "string" && data.error.trim()
    ? data.error
    : fallback;
}

export function useResearchLinks() {
  const [links, setLinks] = useState<SavedLinkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/research/links", { cache: "no-store" });
      const data: unknown = await res.json();
      const parsedLinks = isRecord(data) && data.ok === true && Array.isArray(data.links)
        ? data.links.map(parseSavedLinkSummary)
        : null;
      if (res.ok && parsedLinks && parsedLinks.every((link) => link !== null)) {
        setLinks(parsedLinks);
        setError(null);
      } else {
        setError("Couldn't load saved links.");
      }
    } catch {
      setError("Couldn't load saved links. Is the desktop reachable?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (text: string): Promise<SaveLinksResult> => {
      const trimmed = text.trim();
      if (!trimmed) {
        return {
          ok: false,
          added: 0,
          duplicates: 0,
          failed: [],
          error: "Nothing to save.",
        };
      }
      try {
        const res = await fetch("/api/research/links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: trimmed, source: "desk" }),
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok || !isRecord(data) || data.ok !== true) {
          return {
            ok: false,
            added: 0,
            duplicates: 0,
            failed: [],
            error: responseError(data, `Couldn't save (HTTP ${res.status}).`),
          };
        }

        const added = Array.isArray(data.added) ? data.added.map(parseSavedLinkSummary) : null;
        const duplicates = Array.isArray(data.duplicates)
          && data.duplicates.every((entry) => typeof entry === "string")
          ? data.duplicates
          : null;
        const failed = Array.isArray(data.failed) ? data.failed.map(parseFailure) : null;
        if (
          !added
          || !duplicates
          || !failed
          || !added.every((link) => link !== null)
          || !failed.every((failure) => failure !== null)
        ) {
          return {
            ok: false,
            added: 0,
            duplicates: 0,
            failed: [],
            error: "Couldn't save a valid response.",
          };
        }

        await load();
        return {
          ok: true,
          added: added.length,
          duplicates: duplicates.length,
          failed,
        };
      } catch {
        return {
          ok: false,
          added: 0,
          duplicates: 0,
          failed: [],
          error: "Couldn't save. Is the desktop reachable?",
        };
      }
    },
    [load],
  );

  const loadDetail = useCallback(async (id: string): Promise<SavedLink | null> => {
    const requestedId = id.trim();
    if (!requestedId) return null;
    try {
      const res = await fetch(`/api/research/links?id=${encodeURIComponent(requestedId)}`, {
        cache: "no-store",
      });
      const data: unknown = await res.json();
      if (!res.ok || !isRecord(data) || data.ok !== true) return null;
      return parseSavedLink(data.link);
    } catch {
      return null;
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/research/links", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setLinks((current) => current.filter((link) => link.id !== id));
        return true;
      }
      return false;
    } catch {
      return false; // the next load re-syncs
    }
  }, []);

  return { links, loading, error, load, save, loadDetail, remove };
}
