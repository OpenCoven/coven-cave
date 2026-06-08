import { NextRequest, NextResponse } from "next/server.js";
import { createLibraryStore } from "../../../../lib/library-store.ts";
import { classifyLink } from "../../../../lib/link-classifier.ts";
import type {
  LinkCapture, LinkSource, LibraryBookmark, LibraryReadingItem,
  LibraryGitHubItem, LibrarySectionKind,
} from "../../../../lib/library-types.ts";
import { enrichTitle, fallbackTitle } from "../../../../lib/title-enricher.ts";

type RouteList = "bookmarks" | "reading" | "github";

export type RouteLinkInput = {
  url: string;
  source: LinkSource;
  familiar: string;
  tags?: string[];
  listHint?: RouteList;
};

export type RouteLinkOk = {
  ok: true;
  deduped: boolean;
  item: LibraryBookmark | LibraryReadingItem | LibraryGitHubItem;
  classify: { rule: string; confidence: "high" | "low" };
};
export type RouteLinkErr = { ok: false; error: "invalid_url" | "write_failed" | "busy" };
export type RouteLinkResult = RouteLinkOk | RouteLinkErr;

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function domainFrom(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

function titleFromReadingPath(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  if (!last) return domainFrom(url);
  return last
    .replace(/[-_]+/g, " ")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || domainFrom(url);
}

export async function routeLinkHandler(body: RouteLinkInput): Promise<RouteLinkResult> {
  // FAMILIAR-FALLBACK: The Tier-5 classifier returns `familiar-fallback`;
  // classifyWithFamiliar() (src/lib/familiar-classify.ts) is ready to use
  // but the repo does not yet expose a non-streaming "ask familiar" helper.
  // Until that lands, Tier 5 hosts (twitter.com, x.com, news.ycombinator.com,
  // reddit.com) default to bookmarks. See src/lib/familiar-classify.ts for
  // the finished helper.
  let parsed: URL;
  try { parsed = new URL(body.url); } catch { return { ok: false, error: "invalid_url" }; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "invalid_url" };
  }

  const store = createLibraryStore();
  const sessionId = body.source.kind === "chat" ? body.source.sessionId
    : body.source.kind === "slash" ? body.source.originSessionId
    : null;
  const turnId = body.source.kind === "chat" ? body.source.turnId : null;

  // Dedup check.
  if (await store.hasIndexEntry(body.url, sessionId, turnId)) {
    // Return the previously-written item (best-effort lookup).
    const [bm, rd, gh] = await Promise.all([store.readBookmarks(), store.readReading(), store.readGithub()]);
    const all = [...bm, ...rd, ...gh] as any[];
    const item = all.find((i) => i.url === body.url);
    return {
      ok: true,
      deduped: true,
      item: item ?? ({} as any),
      classify: { rule: item?.capture?.classifier?.rule ?? "default-bookmark", confidence: "low" },
    };
  }

  // Classify (or honor explicit hint).
  let classify = body.listHint
    ? { rule: "default-bookmark" as const, confidence: "low" as const, list: body.listHint }
    : classifyLink(body.url);

  // Phase 7 will replace this branch with a familiar harness call.
  if (classify.rule === "familiar-fallback") {
    classify = { ...classify, list: "bookmarks" };
  }

  const list: RouteList = (classify.list ?? "bookmarks") as RouteList;
  const capture: LinkCapture = {
    source: body.source,
    familiar: body.familiar,
    capturedAt: new Date().toISOString(),
    classifier: { rule: classify.rule, confidence: classify.confidence },
  };

  let item: LibraryBookmark | LibraryReadingItem | LibraryGitHubItem;
  try {
    if (list === "github") {
      const gp = classifyLink(body.url).githubParse;
      const repo = gp?.repo ?? "";
      const number = gp?.number;
      const kind = gp?.kind ?? "repo";
      const rawTitle = number ? `${repo} #${number}` : repo || domainFrom(parsed);
      const enriched = await enrichTitle(body.url);
      const title = enriched?.title ?? rawTitle;
      const ghItem: LibraryGitHubItem = {
        id: generateId("gh"),
        kind, repo, number, title, url: body.url,
        labels: [], savedAt: capture.capturedAt,
        familiar: body.familiar,
        capture,
      };
      await store.appendGithub(ghItem);
      item = ghItem;
    } else if (list === "reading") {
      const readingKind =
        classify.rule === "paper-host" ? "paper" :
        classify.rule === "video-host" ? "video" :
        classify.rule === "article-host" ? "article" : "article";
      const rdItem: LibraryReadingItem = {
        id: generateId("rd"),
        title: (await enrichTitle(body.url))?.title ?? titleFromReadingPath(parsed),
        url: body.url,
        sourceType: readingKind,
        status: "want-to-read",
        tags: body.tags ?? [],
        addedAt: capture.capturedAt,
        familiar: body.familiar,
        capture,
      };
      await store.appendReading(rdItem);
      item = rdItem;
    } else {
      const bmItem: LibraryBookmark = {
        id: generateId("bm"),
        url: body.url,
        title: (await enrichTitle(body.url))?.title ?? fallbackTitle(body.url),
        domain: domainFrom(parsed),
        favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`,
        tags: body.tags ?? [],
        savedAt: capture.capturedAt,
        familiar: body.familiar,
        capture,
      };
      await store.appendBookmark(bmItem);
      item = bmItem;
    }

    await store.appendIndexEntry({ url: body.url, sessionId, turnId, list, itemId: item.id });
  } catch {
    return { ok: false, error: "write_failed" };
  }

  return { ok: true, deduped: false, item, classify: { rule: classify.rule, confidence: classify.confidence } };
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RouteLinkInput;
  const result = await routeLinkHandler(body);
  const status = result.ok ? 200 : result.error === "invalid_url" ? 400 : 500;
  return NextResponse.json(result, { status });
}
