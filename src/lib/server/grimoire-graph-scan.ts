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
import { parseMdDocument } from "../md-frontmatter";
import { buildDocGraph, type DocGraph, type GraphSourceDoc } from "../grimoire-graph";
import type { WikiDocIndex } from "../wiki-link-resolve";

export type GrimoireGraphMeta = {
  knowledge: { scanned: number };
  memory: { scanned: number; total: number };
  journal: { scanned: number; total: number };
};

/** Content is scanned for the most recent N markdown memory files. */
export const MEMORY_SCAN_CAP = 400;
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

export async function scanGrimoireGraph(): Promise<{ graph: DocGraph; meta: GrimoireGraphMeta }> {
  const [knowledge, memoryEntries, journalDays] = await Promise.all([
    listKnowledgeEntries(),
    listMemoryFileEntries(),
    listJournalEntries(),
  ]);

  // Resolution index spans the ENTIRE corpus, scanned or not.
  const index: WikiDocIndex = {
    knowledge: knowledge.map((k) => ({ id: k.id, title: k.title })),
    memory: memoryEntries.map((m) => ({ path: m.fullPath })),
    journal: journalDays.map((j) => ({ date: j.date })),
  };

  const docs: GraphSourceDoc[] = knowledge.map((k) => ({
    ref: { kind: "knowledge", id: k.id },
    title: k.title,
    markdown: k.body,
    tags: k.tags,
  }));

  // Memory — most recently modified markdown files, bounded reads.
  const memoryMarkdown = memoryEntries
    .filter((m) => MARKDOWN_RE.test(m.fullPath))
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
    memory: { scanned: memoryScanSet.length, total: memoryMarkdown.length },
    journal: { scanned: journalScanSet.length, total: journalDays.length },
  };
  return { graph, meta };
}
