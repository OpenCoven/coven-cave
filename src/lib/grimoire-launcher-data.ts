/**
 * Grimoire launcher data — pure logic behind the Memories launcher screen
 * (the Knowledge tab's no-selection state; "Memories Prototype" redesign).
 *
 * Everything here is deterministic and side-effect free so the bento tiles,
 * search, and capture detection can be unit-tested without React: merging the
 * three corpora into one recency pool, week/streak stats, graph counts, and
 * the URL-capture detection for the big search field.
 */

import type { DocGraph } from "@/lib/grimoire-graph";

// ── Inputs (structural — mirrors what grimoire-view already loads) ──────────

export type LauncherKnowledgeInput = {
  id: string;
  collection?: string;
  title: string;
  tags: string[];
  /** Markdown body when the caller has it — feeds the hero excerpt. */
  body?: string;
  /** File mtime ISO string when the list API provides it. */
  modified?: string;
};

export type LauncherMemoryInput = {
  relPath: string;
  fullPath: string;
  modified: string;
  rootLabel: string;
};

export type LauncherJournalInput = {
  date: string;
  preview: string;
  modified: string | null;
};

// ── Pool items ───────────────────────────────────────────────────────────────

export type LauncherDocRef =
  | { kind: "knowledge"; id: string; collection?: string }
  | { kind: "memory"; path: string }
  | { kind: "journal"; date: string };

/** Visual marker classes, after the prototype's type language:
 *  diamond = canonical memory files, ring-dashed = stitches,
 *  ring-open = journal reflections, dot = plain memory files. */
export type LauncherMarker = "diamond" | "ring-dashed" | "ring-open" | "dot";

export type LauncherItem = {
  key: string;
  ref: LauncherDocRef;
  title: string;
  kindLabel: "Stitch" | "Memory" | "Journal";
  marker: LauncherMarker;
  modifiedMs: number | null;
  /** Plain-text snippet for the hero card, when the corpus provides a body. */
  excerpt?: string;
  /** Lowercased searchable text: title + tags + kind. */
  haystack: string;
};

const CANONICAL_MEMORY_FILE = /^(memory|agents|claude|soul|readme)\.md$/i;

export function memoryMarker(relPath: string): LauncherMarker {
  const base = relPath.split("/").pop() ?? relPath;
  return CANONICAL_MEMORY_FILE.test(base) ? "diamond" : "dot";
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** First readable sentence-ish run of a markdown body: headings, link syntax,
 *  emphasis, and code fences stripped, clamped to ~200 chars on a word edge. */
export function launcherExcerpt(body: string | undefined, max = 200): string | undefined {
  if (!body) return undefined;
  const text = body
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/^>\s?/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const edge = cut.lastIndexOf(" ");
  return `${cut.slice(0, edge > max * 0.6 ? edge : max)}…`;
}

/** Merge the three corpora into one pool sorted newest-first (undated last). */
export function buildLauncherItems(input: {
  knowledge: LauncherKnowledgeInput[];
  memory: LauncherMemoryInput[];
  journal: LauncherJournalInput[];
}): LauncherItem[] {
  const items: LauncherItem[] = [];
  for (const k of input.knowledge) {
    const excerpt = launcherExcerpt(k.body);
    items.push({
      key: `knowledge:${k.collection ? `${k.collection}/` : ""}${k.id}`,
      ref: { kind: "knowledge", id: k.id, ...(k.collection ? { collection: k.collection } : {}) },
      title: k.title || k.id,
      kindLabel: "Stitch",
      marker: "ring-dashed",
      modifiedMs: toMs(k.modified),
      ...(excerpt ? { excerpt } : {}),
      haystack: `${k.title} ${k.id} ${k.tags.join(" ")} stitch`.toLowerCase(),
    });
  }
  for (const m of input.memory) {
    const base = m.relPath.split("/").pop() ?? m.relPath;
    items.push({
      key: `memory:${m.fullPath}`,
      ref: { kind: "memory", path: m.fullPath },
      title: base,
      kindLabel: "Memory",
      marker: memoryMarker(m.relPath),
      modifiedMs: toMs(m.modified),
      haystack: `${m.relPath} ${m.rootLabel} memory`.toLowerCase(),
    });
  }
  for (const j of input.journal) {
    const excerpt = launcherExcerpt(j.preview);
    items.push({
      key: `journal:${j.date}`,
      ref: { kind: "journal", date: j.date },
      title: j.date,
      kindLabel: "Journal",
      marker: "ring-open",
      modifiedMs: toMs(j.modified) ?? toMs(`${j.date}T12:00:00`),
      ...(excerpt ? { excerpt } : {}),
      haystack: `${j.date} ${j.preview} journal reflection`.toLowerCase(),
    });
  }
  return items.sort((a, b) => {
    if (a.modifiedMs === null && b.modifiedMs === null) return a.title.localeCompare(b.title);
    if (a.modifiedMs === null) return 1;
    if (b.modifiedMs === null) return -1;
    return b.modifiedMs - a.modifiedMs;
  });
}

/** Every-token-must-match search over the pool. */
export function searchLauncherItems(items: LauncherItem[], query: string, limit = 8): LauncherItem[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const out: LauncherItem[] = [];
  for (const item of items) {
    if (tokens.every((t) => item.haystack.includes(t))) {
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ── Bento stats ──────────────────────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type LauncherWeekStats = { filesTouched: number; reflections: number };

/** End of the local day containing `ms` — the inclusive upper bound for
 *  "this week". Today's noon-anchored journal dates count even in the
 *  morning; genuinely future mtimes (clock skew, future-dated entries)
 *  don't inflate the tiles. */
function endOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Docs touched and reflections written in the trailing 7 days. */
export function launcherWeekStats(
  items: LauncherItem[],
  journal: LauncherJournalInput[],
  nowMs: number,
): LauncherWeekStats {
  const cutoff = nowMs - WEEK_MS;
  const horizon = endOfDayMs(nowMs);
  let filesTouched = 0;
  for (const item of items) {
    if (item.modifiedMs !== null && item.modifiedMs >= cutoff && item.modifiedMs <= horizon) {
      filesTouched += 1;
    }
  }
  let reflections = 0;
  for (const day of journal) {
    const ms = Date.parse(`${day.date}T12:00:00`);
    if (Number.isFinite(ms) && ms >= cutoff && ms <= horizon) reflections += 1;
  }
  return { filesTouched, reflections };
}

/** Consecutive journal days ending today (or yesterday — an unfinished today
 *  doesn't break the streak). Dates are local YYYY-MM-DD strings. */
export function journalStreakDays(dates: string[], todayIso: string): number {
  const have = new Set(dates);
  const today = Date.parse(`${todayIso}T12:00:00`);
  if (!Number.isFinite(today)) return 0;
  const dayIso = (ms: number) => {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Anchor on today when present, else yesterday; otherwise no live streak.
  let cursor = today;
  if (!have.has(dayIso(cursor))) {
    cursor -= DAY_MS;
    if (!have.has(dayIso(cursor))) return 0;
  }
  let streak = 0;
  while (have.has(dayIso(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

export type LauncherGraphCounts = { nodes: number; edges: number; detached: number };

/** Doc-node/edge counts plus detached docs (no edges at all) for the bento. */
export function launcherGraphCounts(graph: DocGraph | null): LauncherGraphCounts {
  if (!graph) return { nodes: 0, edges: 0, detached: 0 };
  let nodes = 0;
  let detached = 0;
  for (const node of graph.nodes) {
    if (node.kind === "tag") continue;
    nodes += 1;
    if (node.degree === 0) detached += 1;
  }
  return { nodes, edges: graph.edges.length, detached };
}

/** The memory root with the most files, for the "N from <root>" line. */
export function topMemoryRoot(memory: LauncherMemoryInput[]): { label: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const m of memory) counts.set(m.rootLabel, (counts.get(m.rootLabel) ?? 0) + 1);
  let best: { label: string; count: number } | null = null;
  for (const [label, count] of counts) {
    if (!best || count > best.count) best = { label, count };
  }
  return best;
}

// ── URL capture detection (search field doubles as an intake) ────────────────

export type LauncherCapture = {
  url: string;
  flavor: "github" | "llms" | "page";
  /** Action label for the primary "pin into a new stitch" affordance. */
  label: string;
};

export function detectLauncherCapture(rawQuery: string): LauncherCapture | null {
  const raw = rawQuery.trim();
  if (!/^(https?:\/\/|www\.)/i.test(raw) || /\s/.test(raw)) return null;
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }
  if (!url.hostname.includes(".")) return null;
  const path = url.pathname;
  if (/(^|\/)llms(-full)?\.txt$/i.test(path)) {
    return { url: normalized, flavor: "llms", label: "Pin llms.txt into a new stitch" };
  }
  if (/(^|\.)github\.com$/i.test(url.hostname) && /^\/[^/]+\/[^/]+/.test(path)) {
    return { url: normalized, flavor: "github", label: "Pin repo into a new stitch" };
  }
  return { url: normalized, flavor: "page", label: "Pin page into a new stitch" };
}
