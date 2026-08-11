/**
 * Link organizer — pure, offline categorization for saved links.
 *
 * "Auto-organize" means: recognize what kind of thing a URL points at from
 * its host/path shape alone (no network fetch — deterministic, instant, and
 * safe), give it a stable category bucket for grouping, and derive a
 * human-readable title from the URL when no better title exists. Powers the
 * chat `/save` (alias `/link`) command and the Research desk's Links shelf.
 */

import type { IconName } from "./icon.tsx";
import { extractLinks } from "./link-extractor.ts";

export type LinkCategory =
  | "github"
  | "docs"
  | "paper"
  | "video"
  | "social"
  | "article"
  | "other";

/** Display order for grouped shelves — most work-relevant buckets first. */
export const LINK_CATEGORY_ORDER: LinkCategory[] = [
  "github",
  "docs",
  "paper",
  "article",
  "video",
  "social",
  "other",
];

export const LINK_CATEGORY_META: Record<LinkCategory, { label: string; icon: IconName }> = {
  github: { label: "GitHub", icon: "ph:github-logo" },
  docs: { label: "Docs", icon: "ph:book-open" },
  paper: { label: "Papers", icon: "ph:graduation-cap" },
  article: { label: "Articles", icon: "ph:newspaper" },
  video: { label: "Video", icon: "ph:video" },
  social: { label: "Discussions", icon: "ph:chats-circle" },
  other: { label: "Other", icon: "ph:link" },
};

export const MAX_LINKS_PER_SAVE = 50;

export type SavedLink = {
  id: string;
  url: string;
  category: LinkCategory;
  title: string;
  addedAt: string;
  /** Where the save originated. */
  source: "chat" | "desk";
};

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "twitch.tv",
  "loom.com",
]);

const SOCIAL_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "reddit.com",
  "news.ycombinator.com",
  "bsky.app",
  "mastodon.social",
  "linkedin.com",
  "discord.com",
]);

const PAPER_HOSTS = new Set([
  "arxiv.org",
  "doi.org",
  "dl.acm.org",
  "openreview.net",
  "semanticscholar.org",
  "biorxiv.org",
  "ssrn.com",
]);

const DOCS_HOST_PATTERNS = [
  /^docs\./,
  /^developer\./,
  /^developers\./,
  /^devdocs\./,
  /^learn\./,
  /^wiki\./,
  /\.readthedocs\.io$/,
];

const DOCS_PATH_PATTERNS = [/^\/docs(\/|$)/, /^\/documentation(\/|$)/, /^\/reference(\/|$)/, /^\/manual(\/|$)/, /^\/wiki(\/|$)/, /^\/guide(s)?(\/|$)/, /^\/learn(\/|$)/, /^\/api(\/|$)/];

const ARTICLE_HOSTS = new Set([
  "medium.com",
  "dev.to",
  "substack.com",
  "hashnode.dev",
  "notion.site",
]);

const ARTICLE_PATH_PATTERNS = [/^\/blog(\/|$)/, /^\/posts?(\/|$)/, /^\/articles?(\/|$)/, /^\/news(\/|$)/, /^\/\d{4}\/\d{2}(\/|$)/];

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function hostMatches(host: string, set: Set<string>): boolean {
  return set.has(host) || [...set].some((entry) => host.endsWith(`.${entry}`));
}

/** Categorize a URL by host/path shape. Unknown → "other". */
export function categorizeLink(rawUrl: string): LinkCategory {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "other";
  }
  const host = bareHost(url.hostname);
  const pathname = url.pathname;

  if (host === "github.com" || host === "gist.github.com" || host.endsWith(".github.io")) {
    return "github";
  }
  if (hostMatches(host, PAPER_HOSTS)) return "paper";
  if (hostMatches(host, VIDEO_HOSTS)) return "video";
  if (hostMatches(host, SOCIAL_HOSTS)) return "social";
  if (
    DOCS_HOST_PATTERNS.some((re) => re.test(host)) ||
    DOCS_PATH_PATTERNS.some((re) => re.test(pathname))
  ) {
    return "docs";
  }
  if (
    hostMatches(host, ARTICLE_HOSTS) ||
    ARTICLE_PATH_PATTERNS.some((re) => re.test(pathname))
  ) {
    return "article";
  }
  return "other";
}

/** Humanize one path segment: slug/underscores → words, drop extensions. */
function humanizeSegment(segment: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();
  return decoded
    .replace(/\.(html?|php|aspx?|md)$/i, "")
    .replace(/[-_+]+/g, " ")
    .trim();
}

/**
 * Derive a readable title from the URL alone (no fetch): the last meaningful
 * path segment humanized, prefixed with the bare host. GitHub repos keep
 * their `owner/repo` shape.
 */
export function deriveLinkTitle(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const host = bareHost(url.hostname);
  const segments = url.pathname.split("/").filter(Boolean);

  if ((host === "github.com" || host === "gist.github.com") && segments.length >= 2) {
    const repo = `${segments[0]}/${segments[1]}`;
    // PRs/issues title as owner/repo #N; other deep paths keep a wordy tail.
    if (segments.length >= 4 && (segments[2] === "pull" || segments[2] === "issues") && /^\d+$/.test(segments[3])) {
      return `${repo} #${segments[3]}`;
    }
    const tail = segments.length > 3 ? humanizeSegment(segments[segments.length - 1]) : "";
    return tail && /[a-z]/i.test(tail) ? `${repo} — ${tail}` : repo;
  }

  // Walk backwards past numeric-only / id-shaped segments to a wordy one.
  for (let i = segments.length - 1; i >= 0; i--) {
    const human = humanizeSegment(segments[i]);
    if (human.length >= 3 && /[a-z]/i.test(human)) {
      return `${human} · ${host}`;
    }
  }
  return host;
}

/** Canonical dedupe key: lowercased host, no trailing slash, no fragment. */
export function normalizeLinkUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl.trim();
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  // Normalize the pathname itself (not the serialized string) so trailing
  // slashes disappear even when a query string follows: /blog/?p=1 and
  // /blog?p=1 must produce the same key. Collapse doubled separators too.
  const collapsed = url.pathname.replace(/\/{2,}/g, "/");
  url.pathname = collapsed !== "/" ? collapsed.replace(/\/+$/, "") : "/";
  let out = url.toString();
  if (url.pathname === "/" && !url.search && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

export type LinkIntakeItem = {
  url: string;
  category: LinkCategory;
  alreadySaved: boolean;
};

export type LinkIntakeSummary = {
  detectedCount: number;
  ready: LinkIntakeItem[];
  duplicates: LinkIntakeItem[];
  categoryCounts: Partial<Record<LinkCategory, number>>;
  overLimit: boolean;
  canSubmit: boolean;
};

/**
 * Build the Resources intake preview from the same extraction and normalized
 * dedupe rules the server uses. This is advisory; the server remains the
 * authoritative validator and writer.
 */
export function summarizeLinkIntake(
  text: string,
  savedLinks: readonly Pick<SavedLink, "url">[],
): LinkIntakeSummary {
  const extracted = extractLinks(text);
  const existing = new Set(savedLinks.map((link) => normalizeLinkUrl(link.url)));
  const unique = new Map<string, LinkIntakeItem>();

  for (const url of extracted) {
    const key = normalizeLinkUrl(url);
    if (unique.has(key)) continue;
    unique.set(key, {
      url,
      category: categorizeLink(url),
      alreadySaved: existing.has(key),
    });
  }

  const items = [...unique.values()];
  const ready = items.filter((item) => !item.alreadySaved);
  const duplicates = items.filter((item) => item.alreadySaved);
  const categoryCounts: Partial<Record<LinkCategory, number>> = {};
  for (const item of items) {
    categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;
  }
  const overLimit = extracted.length > MAX_LINKS_PER_SAVE;

  return {
    detectedCount: extracted.length,
    ready,
    duplicates,
    categoryCounts,
    overLimit,
    canSubmit: extracted.length > 0 && ready.length > 0 && !overLimit,
  };
}

/**
 * Meta for a category, tolerating unknown values. The links store is shared
 * across app versions (chat /save, desk, future writers) — an unrecognized
 * category must degrade to "Other", never crash a surface.
 */
export function linkCategoryMeta(category: string): { label: string; icon: IconName } {
  return LINK_CATEGORY_META[category as LinkCategory] ?? LINK_CATEGORY_META.other;
}

export type LinkUsageGroupId = "selected" | "uncited" | "cited";

export type LinkUsageGroup = {
  id: LinkUsageGroupId;
  label: string;
  description: string;
  links: SavedLink[];
};

/** Group links by how they relate to the selected and prior research runs. */
export function groupSavedLinksByUsage<TMission extends { id: string }>(
  links: SavedLink[],
  citedByUrl: ReadonlyMap<string, readonly TMission[]>,
  selectedMissionId?: string,
): LinkUsageGroup[] {
  const selected: SavedLink[] = [];
  const uncited: SavedLink[] = [];
  const cited: SavedLink[] = [];

  for (const link of links) {
    const missions = citedByUrl.get(normalizeLinkUrl(link.url)) ?? [];
    if (selectedMissionId && missions.some((mission) => mission.id === selectedMissionId)) {
      selected.push(link);
    } else if (missions.length === 0) {
      uncited.push(link);
    } else {
      cited.push(link);
    }
  }

  const groups: LinkUsageGroup[] = [];
  if (selectedMissionId) {
    groups.push({
      id: "selected",
      label: "In this run",
      description: "Already attached to the selected run",
      links: selected,
    });
  }
  groups.push({
    id: "uncited",
    label: "Uncited",
    description: "Not used by any research run yet",
    links: uncited,
  });
  groups.push({
    id: "cited",
    label: selectedMissionId ? "Used in other runs" : "Used in runs",
    description: selectedMissionId
      ? "Used elsewhere and available to add here"
      : "Used by one or more research runs",
    links: cited,
  });
  return groups.filter((group) => group.links.length > 0);
}
