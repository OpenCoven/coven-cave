import type { GitHubItemKind } from "./library-types";

export type ClassifyList = "github" | "reading" | "bookmarks";
export type ClassifyRule =
  | "github"
  | "paper-host"
  | "video-host"
  | "article-host"
  | "default-bookmark"
  | "familiar-fallback";

export type ClassifyResult = {
  list?: ClassifyList;
  readingKind?: "article" | "paper" | "video" | "thread";
  githubParse?: { repo: string; kind: GitHubItemKind; number?: number };
  rule: ClassifyRule;
  confidence: "high" | "low";
};

const PAPER_HOSTS = new Set([
  "arxiv.org",
  "paperswithcode.com",
  "nature.com",
  "sciencemag.org",
  "aclanthology.org",
  "openreview.net",
  "semanticscholar.org",
]);

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "www.vimeo.com",
  "loom.com",
]);

const ARTICLE_HOST_SUFFIXES = [".substack.com", ".medium.com"];
const ARTICLE_HOSTS = new Set(["medium.com", "dev.to", "hashnode.dev"]);
const AMBIGUOUS_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "news.ycombinator.com",
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
]);

function isGithubHost(host: string): boolean {
  return host === "github.com" || host === "www.github.com" || host.endsWith(".github.com");
}

export function parseGitHubUrl(
  url: string,
): { repo: string; kind: GitHubItemKind; number?: number } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!isGithubHost(u.hostname.toLowerCase())) return null;
  const parts = u.pathname.replace(/^\//, "").split("/");
  if (parts.length < 2) return null;
  const repo = `${parts[0]}/${parts[1]}`;
  if (parts.length === 2) return { repo, kind: "repo" };
  if (parts[2] === "issues" && parts[3]) return { repo, kind: "issue", number: parseInt(parts[3], 10) };
  if (parts[2] === "pull" && parts[3]) return { repo, kind: "pr", number: parseInt(parts[3], 10) };
  if (parts[2] === "discussions" && parts[3]) return { repo, kind: "discussion", number: parseInt(parts[3], 10) };
  return { repo, kind: "repo" };
}

function isArticleHost(host: string): boolean {
  if (ARTICLE_HOSTS.has(host)) return true;
  for (const suffix of ARTICLE_HOST_SUFFIXES) if (host.endsWith(suffix)) return true;
  if (host.startsWith("blog.")) return true;
  return false;
}

function isArticlePath(pathname: string): boolean {
  return /\/(blog|posts|articles)\//.test(pathname);
}

export function classifyLink(url: string): ClassifyResult {
  let u: URL;
  try { u = new URL(url); } catch { return { rule: "default-bookmark", confidence: "low", list: "bookmarks" }; }
  const host = u.hostname.toLowerCase();

  // Tier 1
  if (isGithubHost(host)) {
    return {
      list: "github",
      rule: "github",
      confidence: "high",
      githubParse: parseGitHubUrl(url) ?? undefined,
    };
  }

  // Tier 2
  if (PAPER_HOSTS.has(host)) return { list: "reading", readingKind: "paper", rule: "paper-host", confidence: "high" };

  // Tier 3
  if (VIDEO_HOSTS.has(host)) return { list: "reading", readingKind: "video", rule: "video-host", confidence: "high" };

  // Tier 4
  if (isArticleHost(host) || isArticlePath(u.pathname)) {
    return { list: "reading", readingKind: "article", rule: "article-host", confidence: "high" };
  }

  // Tier 5 — caller awaits familiar fallback
  if (AMBIGUOUS_HOSTS.has(host)) return { rule: "familiar-fallback", confidence: "low" };

  // Default
  return { list: "bookmarks", rule: "default-bookmark", confidence: "low" };
}
