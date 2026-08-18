import { extractLinks } from "./link-extractor.ts";
import { arxivIdFromUrl, hfPaperUrl } from "./hf-papers.ts";
import { normalizeLinkUrl } from "./link-organizer.ts";
import { normalizedHttpLinkKey } from "./board-card-ops.ts";
import { extractChatRenderedText } from "./chat-rendered-text.ts";
import { descriptorUrl, sliceGitHubBlocks } from "./github-blocks.ts";
import { stripImageMarkers } from "./image-blocks.ts";
import { stripPreviewMarkers } from "./preview-blocks.ts";

export type FollowUpLinkDestination =
  | { destination: "resources"; urls: string[] }
  | { destination: "task"; taskId: string; urls: string[] };

export type SaveFollowUpLinksResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const SAVE_ERROR = "Couldn't save links.";
const LINK_CATEGORIES = new Set([
  "github",
  "docs",
  "paper",
  "video",
  "social",
  "article",
  "other",
]);

type JsonRecord = Record<string, unknown>;
type ResourceSavedLink = {
  id: string;
  url: string;
  category: string;
  title: string;
  addedAt: string;
  source: "chat" | "desk";
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isSavedLink(value: unknown): value is ResourceSavedLink {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.category === "string" &&
    LINK_CATEGORIES.has(value.category) &&
    typeof value.title === "string" &&
    typeof value.addedAt === "string" &&
    (value.source === "chat" || value.source === "desk")
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const LINK_OP_OUTCOMES = new Set(["added", "duplicate", "invalid"]);

type LinkOpOutcomeEntry = {
  requestedUrl: string;
  normalizedUrl: string | null;
  outcome: "added" | "duplicate" | "invalid";
};

function isLinkOpOutcomeEntry(value: unknown): value is LinkOpOutcomeEntry {
  return (
    isRecord(value) &&
    typeof value.requestedUrl === "string" &&
    (value.normalizedUrl === null || typeof value.normalizedUrl === "string") &&
    typeof value.outcome === "string" &&
    LINK_OP_OUTCOMES.has(value.outcome)
  );
}

/**
 * A reported outcome is only trustworthy when it is internally consistent
 * with its own requested URL under the exact same validity/canonical rules
 * `board-card-ops.ts` uses to actually resolve `addNormalizedUrl` requests
 * (`normalizedHttpLinkKey`) — reused here rather than re-derived, so this
 * check can never drift from what the server is actually allowed to report:
 * a valid http(s) request must report the canonical normalized URL and an
 * "added" or "duplicate" outcome; an invalid/non-http(s) request must report
 * a null normalizedUrl and an "invalid" outcome. Anything else (a mismatched
 * or noncanonical normalizedUrl, an "invalid" outcome for a valid URL, or an
 * "added"/"duplicate" outcome for an invalid URL) fails closed.
 */
function isConsistentLinkOpOutcome(requestedUrl: string, entry: LinkOpOutcomeEntry): boolean {
  const canonical = normalizedHttpLinkKey(requestedUrl);
  if (canonical === null) {
    return entry.normalizedUrl === null && entry.outcome === "invalid";
  }
  return (
    entry.normalizedUrl === canonical &&
    (entry.outcome === "added" || entry.outcome === "duplicate")
  );
}

function resourceIdentity(value: string): string {
  const paperId = arxivIdFromUrl(value);
  return normalizeLinkUrl(paperId ? hfPaperUrl(paperId) : value);
}

function accountsForEveryRequest(requested: string[], outcomes: string[]): boolean {
  const requestedCounts = new Map<string, number>();
  for (const value of requested) {
    const key = resourceIdentity(value);
    requestedCounts.set(key, (requestedCounts.get(key) ?? 0) + 1);
  }

  const outcomeCounts = new Map<string, number>();
  for (const outcome of outcomes) {
    const key = resourceIdentity(outcome);
    const requestedCount = requestedCounts.get(key);
    if (!requestedCount) return false;
    const nextCount = (outcomeCounts.get(key) ?? 0) + 1;
    if (nextCount > requestedCount) return false;
    outcomeCounts.set(key, nextCount);
  }
  return [...requestedCounts.keys()].every((key) => outcomeCounts.has(key));
}

function serverError(value: unknown): string | null {
  if (!isRecord(value) || value.ok !== false || typeof value.error !== "string") return null;
  const error = value.error.trim();
  return error || null;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function linksFromFollowUpSource(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  const projection = extractChatRenderedText(text);
  for (const piece of sliceGitHubBlocks(projection.cardText)) {
    const candidates = piece.kind === "card"
      ? [descriptorUrl(piece.descriptor)]
      : piece.kind === "text"
        ? extractLinks(stripPreviewMarkers(stripImageMarkers(piece.text)))
        : [];
    for (const url of candidates) {
      const key = normalizeLinkUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(key);
    }
  }

  return links;
}

export async function saveFollowUpLinks(
  request: FollowUpLinkDestination,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveFollowUpLinksResult> {
  if (request.urls.length === 0) {
    return { ok: false, error: "Select at least one link." };
  }

  try {
    const response = request.destination === "resources"
      ? await fetchImpl("/api/research/links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ urls: request.urls, source: "chat" }),
        })
      : await fetchImpl(`/api/board/${encodeURIComponent(request.taskId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ops: {
              linkOps: request.urls.map((value) => ({ op: "addNormalizedUrl", value })),
            },
          }),
        });
    const body = await responseJson(response);
    const error = serverError(body);
    if (!response.ok || error) return { ok: false, error: error ?? SAVE_ERROR };

    if (request.destination === "resources") {
      if (
        !isRecord(body) ||
        body.ok !== true ||
        !Array.isArray(body.added) ||
        !body.added.every(isSavedLink) ||
        !isStringArray(body.duplicates) ||
        !isStringArray(body.invalid)
      ) {
        return { ok: false, error: SAVE_ERROR };
      }
      const added = body.added as ResourceSavedLink[];
      const duplicates = body.duplicates as string[];
      const invalid = body.invalid as string[];
      if (
        !added.every((link) => isHttpUrl(link.url)) ||
        !duplicates.every(isHttpUrl) ||
        invalid.some(isHttpUrl) ||
        !accountsForEveryRequest(
          request.urls,
          [...added.map((link) => link.url), ...duplicates, ...invalid],
        )
      ) {
        return { ok: false, error: SAVE_ERROR };
      }
      return {
        ok: true,
        message: `${added.length} saved, ${duplicates.length} already saved, ${invalid.length} invalid in Research Resources.`,
      };
    }

    if (
      !isRecord(body) ||
      body.ok !== true ||
      !isRecord(body.card) ||
      body.card.id !== request.taskId
    ) {
      return { ok: false, error: SAVE_ERROR };
    }
    // The route resolves per-request added/duplicate/invalid outcomes under
    // its own board lock and returns them positionally in `opsOutcome.linkOps`
    // — never inferred here from the (possibly stale, add-vs-duplicate-blind)
    // `card.links` snapshot in the response body.
    const outcome = body.opsOutcome;
    if (!isRecord(outcome) || !Array.isArray(outcome.linkOps)) {
      return { ok: false, error: SAVE_ERROR };
    }
    const linkOps = outcome.linkOps;
    if (linkOps.length !== request.urls.length) {
      return { ok: false, error: SAVE_ERROR };
    }
    for (let i = 0; i < linkOps.length; i++) {
      const entry = linkOps[i];
      if (
        !isLinkOpOutcomeEntry(entry) ||
        entry.requestedUrl !== request.urls[i] ||
        !isConsistentLinkOpOutcome(request.urls[i], entry)
      ) {
        return { ok: false, error: SAVE_ERROR };
      }
    }
    const entries = linkOps as LinkOpOutcomeEntry[];
    const added = entries.filter((entry) => entry.outcome === "added").length;
    const duplicates = entries.filter((entry) => entry.outcome === "duplicate").length;
    const invalid = entries.filter((entry) => entry.outcome === "invalid").length;
    if (duplicates === 0 && invalid === 0) {
      return {
        ok: true,
        message: added === 1
          ? "1 selected link is now on the current task."
          : `${added} selected links are now on the current task.`,
      };
    }
    return {
      ok: true,
      message: `${added} added, ${duplicates} already on the task, ${invalid} invalid for the current task.`,
    };
  } catch {
    return { ok: false, error: SAVE_ERROR };
  }
}
