// Server-side Grimoire graph scan (cave-hand) — gathers the FULL corpus
// (knowledge vault + memory files + journal reflections) and feeds it through
// the pure `buildDocGraph` builder, so the graph is generated over every doc
// the Grimoire lists, not just the knowledge bodies the client happens to have
// loaded. Serves GET /api/grimoire/graph.
//
// Cost model: knowledge + journal are small; memory inventories can run to
// thousands of files (a cold full-content scan once took ~25s — see
// memory-file-inventory.ts). So memory content reads are BOUNDED, and the
// bounds are surfaced in `meta` instead of silently truncating:
//   - only the MEMORY_SCAN_CAP most recently modified markdown files are read
//   - each read stops at CONTENT_BYTE_CAP bytes
//   - contents cache on (mtime, size), so steady-state rescans hit disk only
//     for files that actually changed
// Every memory file still participates in the doc index, so [[links]] into
// unscanned files resolve and land as leaf nodes.

import { open } from "node:fs/promises";
import { listKnowledgeEntries } from "./knowledge-vault";
import { listMemoryFileEntries } from "./memory-file-inventory";
import { listJournalEntries, readJournalEntry } from "./journal-store";
import { familiarInScope } from "../familiar-multiselect";
import { parseMdDocument } from "../md-frontmatter";
import { buildDocGraph, type DocGraph, type GraphSourceDoc } from "../grimoire-graph";
import type { WikiDocIndex } from "../wiki-link-resolve";

export type GrimoireGraphMeta = {
  knowledge: { scanned: number };
  /**
   * Scope-relative once a familiar scope is supplied: `total` counts the
   * markdown memory files owned by the scope, not the whole coven, so
   * `scanned < total` keeps meaning "this scope has more than the cap shows"
   * rather than "the coven does" (cave-z6xvd). `scoped` says which reading
   * applies, so the shortfall notice never has to infer it.
   */
  memory: { scanned: number; total: number; scoped: boolean };
  journal: { scanned: number; total: number };
};

/**
 * Content is scanned for the most recent N markdown memory files.
 *
 * ⚠️ The binding constraint is NOT the I/O this file's cost model describes —
 * it is the RENDERER. `tickForceSim` (lib/grimoire-force.ts) computes repulsion
 * as symmetric O(n²), and the graph view ticks it ~148 times to settle. Read
 * cost is near-irrelevant by comparison; the ~25s figure quoted above was for
 * UNBOUNDED reads, a cost CONTENT_BYTE_CAP already removed.
 *
 * Measured 2026-08-08 on a 3393-file corpus (scan total = read + frontmatter
 * parse + buildDocGraph; tick cost at the node count each cap produces):
 *
 *   cap    scan     nodes   ms/tick   settle (148 ticks)
 *    400   340ms      464      1.3      0.19s
 *   1000   619ms     1160      3.1      0.46s
 *   1200      —      1392      4.4      0.65s   ← here
 *   2000   984ms     2320     12.8      1.89s
 *   3393  1387ms     3812     36.6      5.42s
 *
 * 1200 keeps the sim at ~27% of a 60fps frame BEFORE canvas drawing, on a fast
 * machine. 2000 spends 77% of the budget on simulation alone and takes nearly
 * two seconds to settle — every reheat, not just first paint. So raising this
 * further is a RENDERER change first: make repulsion Barnes-Hut, or bound the
 * node count independently of the scan. Do not raise it on I/O evidence alone.
 *
 * The cap is now applied AFTER the familiar scope rather than coven-wide, so a
 * scoped view gets that familiar's most-recent N instead of their slice of the
 * coven's most-recent N (cave-z6xvd). It used to be the other way round, which
 * meant a familiar owning F of T files saw roughly (F/T) × CAP of their own —
 * 260 of ~2065 files is 12.6%, so 400 → 1200 moved them from ~35 nodes to ~150
 * and reaching all 260 would have needed a cap near 2065, i.e. the whole corpus
 * at 1.89s of settle time.
 *
 * Scoping first is why the cap no longer has to grow to fix that: coverage goes
 * UP while the node count stays SMALL, so the O(n²) sim stays cheap. The
 * unscoped ("All") view is unchanged and still bounded coven-wide by this cap,
 * and the graph view still states any remaining shortfall outright — `meta`
 * reports it scope-relative (cave-ed4s3).
 */
export const MEMORY_SCAN_CAP = 1200;
/** …and the most recent N journal days. */
export const JOURNAL_SCAN_CAP = 200;
/** Per-file byte cap — links/tags overwhelmingly live near the top. */
const CONTENT_BYTE_CAP = 32 * 1024;
const READ_CONCURRENCY = 16;

const MARKDOWN_RE = /\.(md|markdown)$/i;

// (mtime|size)-keyed content cache, LRU-ish via Map insertion order.
const contentCache = new Map<string, { stamp: string; text: string }>();
const CONTENT_CACHE_MAX = 600;

async function readCapped(fullPath: string): Promise<string | null> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(fullPath, "r");
    const buf = Buffer.alloc(CONTENT_BYTE_CAP);
    const { bytesRead } = await fh.read(buf, 0, CONTENT_BYTE_CAP, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
}

async function readCachedContent(fullPath: string, stamp: string): Promise<string | null> {
  const cached = contentCache.get(fullPath);
  if (cached && cached.stamp === stamp) {
    // Refresh recency so hot entries survive eviction.
    contentCache.delete(fullPath);
    contentCache.set(fullPath, cached);
    return cached.text;
  }
  const text = await readCapped(fullPath);
  if (text === null) return null;
  contentCache.set(fullPath, { stamp, text });
  while (contentCache.size > CONTENT_CACHE_MAX) {
    const oldest = contentCache.keys().next().value;
    if (oldest === undefined) break;
    contentCache.delete(oldest);
  }
  return text;
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function memoryBasename(fullPath: string): string {
  const seg = fullPath.split(/[\\/]/).pop() ?? fullPath;
  return seg.replace(MARKDOWN_RE, "");
}

/**
 * Scan the corpus, optionally narrowed to a familiar scope.
 *
 * The scope is applied BEFORE the cap, which is the whole point (cave-z6xvd).
 * Truncating coven-wide and scoping afterwards handed a familiar owning F of T
 * files roughly (F/T) × CAP of their own — never all F, whatever the cap. At
 * 260 of ~2065 files that is 12.6%, so cap 1200 showed ~150 of 260 and closing
 * the gap by raising the cap would have needed ~2065, where the O(n²) force sim
 * costs 1.9s to settle.
 *
 * Scoping first is better on BOTH axes rather than a trade: the familiar gets
 * all of their files up to the cap, AND the node count stays small so the sim
 * stays cheap. Only MEMORY entries carry an owner, so only they are scoped —
 * knowledge and journal stay coven-wide, matching `scopeDocGraph`, because they
 * are the graph's connective tissue.
 *
 * An empty scope means "All" and reproduces the previous coven-wide behavior
 * exactly, so the unscoped caller is unchanged.
 */
export async function scanGrimoireGraph(
  familiarScope: ReadonlySet<string> = new Set(),
): Promise<{ graph: DocGraph; meta: GrimoireGraphMeta }> {
  const [knowledge, memoryEntries, journalDays] = await Promise.all([
    listKnowledgeEntries(),
    listMemoryFileEntries(),
    listJournalEntries(),
  ]);

  // Resolution index spans the ENTIRE corpus, scanned or not.
  const index: WikiDocIndex = {
    knowledge: knowledge.map((k) => ({ id: k.id, collection: k.collection, title: k.title })),
    memory: memoryEntries.map((m) => ({ path: m.fullPath })),
    journal: journalDays.map((j) => ({ date: j.date })),
  };

  const docs: GraphSourceDoc[] = knowledge.map((k) => ({
    ref: { kind: "knowledge", id: k.id, ...(k.collection ? { collection: k.collection } : {}) },
    title: k.title,
    markdown: k.body,
    tags: k.tags,
  }));

  // Memory — most recently modified markdown files, bounded reads.
  const memoryMarkdown = memoryEntries
    .filter((m) => MARKDOWN_RE.test(m.fullPath) && familiarInScope(familiarScope, m.familiarId))
    .sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0));
  const memoryScanSet = memoryMarkdown.slice(0, MEMORY_SCAN_CAP);
  const memoryDocs = await mapConcurrent(memoryScanSet, async (m) => {
    const text = await readCachedContent(m.fullPath, `${m.modified}|${m.size}`);
    if (text === null) return null;
    const parsed = parseMdDocument(text);
    return {
      ref: { kind: "memory", path: m.fullPath },
      title: parsed.title?.trim() || memoryBasename(m.fullPath),
      markdown: text,
      tags: parsed.tags,
    } satisfies GraphSourceDoc;
  });
  for (const d of memoryDocs) if (d) docs.push(d);

  // Journal — most recent days first (the list is already newest-first, but
  // don't rely on it).
  const journalScanSet = [...journalDays]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, JOURNAL_SCAN_CAP);
  const journalDocs = await mapConcurrent(journalScanSet, async (j) => {
    try {
      const record = await readJournalEntry(j.date);
      if (!record.exists) return null;
      return {
        ref: { kind: "journal", date: j.date },
        title: j.date,
        markdown: record.entry.reflection,
      } satisfies GraphSourceDoc;
    } catch {
      return null;
    }
  });
  for (const d of journalDocs) if (d) docs.push(d);

  const graph = buildDocGraph(docs, index);
  const meta: GrimoireGraphMeta = {
    knowledge: { scanned: knowledge.length },
    memory: {
      scanned: memoryScanSet.length,
      total: memoryMarkdown.length,
      scoped: familiarScope.size > 0,
    },
    journal: { scanned: journalScanSet.length, total: journalDays.length },
  };
  return { graph, meta };
}
