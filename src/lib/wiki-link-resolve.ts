// Resolve `[[wiki-link]]` targets (from `wiki-link-parser.ts`) to real Grimoire
// docs. Pure + UI-agnostic: it matches a target string against the doc lists
// the Grimoire navigator already loads (knowledge vault / memory files /
// journal days), so no server round-trip or full-vault index is needed to turn
// a doc's outgoing links into navigable references.

import { extractWikiLinks, type WikiLink } from "./wiki-link-parser";

/** A resolved reference — the same shape the Grimoire deep-link bridge uses
 *  (`grimoire-link.ts` / `GrimoireSelection`), minus the transient drafts. */
export type WikiDocRef =
  | { kind: "knowledge"; id: string }
  | { kind: "memory"; path: string }
  | { kind: "journal"; date: string };

/** Minimal doc metadata the resolver matches against — a subset of the
 *  navigator's loaded lists, so callers pass what they already have. */
export type WikiDocIndex = {
  knowledge: readonly { id: string; title?: string | null }[];
  memory: readonly { path: string }[];
  journal: readonly { date: string }[];
};

export type ResolvedWikiLink = WikiLink & {
  /** The matched doc, or null when nothing in the index matches the target. */
  ref: WikiDocRef | null;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Last path segment with any `.md`/`.markdown` extension stripped. */
function baseName(path: string): string {
  const seg = path.split(/[\\/]/).pop() ?? path;
  return seg.replace(/\.(md|markdown)$/i, "");
}

function stripExt(path: string): string {
  return path.replace(/\.(md|markdown)$/i, "");
}

/**
 * Resolve a single wiki-link target to a doc ref, or null if unresolved.
 *
 * Match order is deterministic and mirrors how a person reads a `[[link]]`:
 * an ISO date is a journal day; otherwise a knowledge entry (by id, then
 * title); otherwise a memory file (by basename, then relative path). All
 * comparisons are case-insensitive; `.md`/`.markdown` extensions are optional
 * in the target.
 */
export function resolveWikiLinkTarget(target: string, index: WikiDocIndex): WikiDocRef | null {
  const t = norm(target);
  if (!t) return null;

  // 1) Journal day — only when the target is literally an ISO date that exists.
  if (ISO_DATE_RE.test(target.trim())) {
    const day = index.journal.find((j) => j.date === target.trim());
    if (day) return { kind: "journal", date: day.date };
  }

  // 2) Knowledge — by slug id, then by human title.
  const byId = index.knowledge.find((k) => norm(k.id) === t);
  if (byId) return { kind: "knowledge", id: byId.id };
  const byTitle = index.knowledge.find((k) => k.title && norm(k.title) === t);
  if (byTitle) return { kind: "knowledge", id: byTitle.id };

  // 3) Memory — by file basename, then by full relative path (extension optional).
  const tNoExt = norm(stripExt(target));
  const byBase = index.memory.find((m) => norm(baseName(m.path)) === tNoExt);
  if (byBase) return { kind: "memory", path: byBase.path };
  const byPath = index.memory.find((m) => norm(stripExt(m.path)) === tNoExt);
  if (byPath) return { kind: "memory", path: byPath.path };

  return null;
}

/** Parse a doc's markdown and resolve every wiki-link in it (occurrence order,
 *  duplicates kept — callers de-dupe if they want unique chips). */
export function resolveOutgoingLinks(markdown: string, index: WikiDocIndex): ResolvedWikiLink[] {
  return extractWikiLinks(markdown).map((link) => ({
    ...link,
    ref: resolveWikiLinkTarget(link.target, index),
  }));
}

/** A stable string key for a doc ref (dedupe / comparison / graph node ids). */
export function docRefKey(ref: WikiDocRef): string {
  return ref.kind === "knowledge"
    ? `knowledge:${ref.id}`
    : ref.kind === "memory"
      ? `memory:${ref.path}`
      : `journal:${ref.date}`;
}
