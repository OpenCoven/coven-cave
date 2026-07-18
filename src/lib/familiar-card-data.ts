/**
 * Pure data-shaping helpers for the chat-avatar inline card.
 * No React, no fetch — unit-tested in familiar-card-data.test.ts.
 */

import { GROWTH_THRESHOLDS } from "@/lib/familiar-growth-signals";
import { relativeTime } from "@/lib/relative-time";

/** Minimal shape of a /api/memory entry this card consumes. */
export type RawMemoryEntry = {
  familiarId?: string;
  relPath: string;
  excerpt?: string;
  modified: string;
  fullPath: string;
};

export type MemoryPeekEntry = {
  /** First markdown heading in the excerpt, else basename of relPath. */
  title: string;
  excerpt: string;
  modified: string;
  fullPath: string;
  /** Source-relative path — tooltip context for the card's open action. */
  relPath: string;
  /** Older than GROWTH_THRESHOLDS.staleMemoryDays — badge as stale. */
  stale: boolean;
};

export type FamiliarStatusInfo = {
  status?: string;
  lastSeen?: string | null;
  activeSessions?: number;
};

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const STALE_MEMORY_MS = GROWTH_THRESHOLDS.staleMemoryDays * 24 * 60 * 60_000;

/**
 * Raw memory excerpts are the first ~200 chars of a markdown file, so they
 * usually open with a heading run ("# 2026-07-11" then "## Coven sign-off").
 * Use the LAST heading of that leading run as the human title (a date-stamped
 * H1 just duplicates the filename; the deepest heading names the topic) and
 * the remaining lines, joined for single-line display, as the excerpt.
 */
export function memoryTitleAndExcerpt(
  relPath: string,
  rawExcerpt: string | undefined,
): { title: string; excerpt: string } {
  const fallback = basename(relPath);
  const raw = (rawExcerpt ?? "").trim();
  if (!raw) return { title: fallback, excerpt: "" };
  const lines = raw.split("\n").map((l) => l.trim());
  let i = 0;
  let title = "";
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }
    const m = /^#{1,6}\s+(.+)$/.exec(line);
    if (!m) break;
    title = m[1].trim();
    i++;
  }
  const body = lines
    .slice(i)
    .filter(Boolean)
    .join(" ")
    .replace(/^[\s\-–—:]+/, "");
  if (!title) return { title: fallback, excerpt: body };
  return { title, excerpt: body };
}

/** Filter memory entries to one familiar, newest-first, limited, mapped. */
export function pickFamiliarMemory(
  entries: RawMemoryEntry[],
  familiarId: string,
  limit = 3,
  now: number = Date.now(),
): MemoryPeekEntry[] {
  return entries
    .filter((e) => e.familiarId === familiarId)
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
    .slice(0, limit)
    .map((e) => {
      const { title, excerpt } = memoryTitleAndExcerpt(e.relPath, e.excerpt);
      const modifiedMs = Date.parse(e.modified);
      return {
        title,
        excerpt,
        modified: e.modified,
        fullPath: e.fullPath,
        relPath: e.relPath,
        stale: Number.isFinite(modifiedMs) && now - modifiedMs > STALE_MEMORY_MS,
      };
    });
}

/** Relative time, mirrors familiar-status-card's relTime. */
export function formatRelTime(iso: string | null | undefined): string {
  return iso ? relativeTime(iso) : "never";
}

export type StatusMeta = { label: string; color: string; pulse: boolean };

/** Map a free-form daemon status string to a label/color/pulse. */
export function statusMeta(status: string | undefined): StatusMeta {
  switch (status) {
    case "active":
      return { label: "Active", color: "#4ade80", pulse: true };
    case "idle":
      return { label: "Idle", color: "#60a5fa", pulse: false };
    case "busy":
    case "running":
      return { label: "Working", color: "#fbbf24", pulse: true };
    case "offline":
      return { label: "Offline", color: "var(--border-strong, #555)", pulse: false };
    default:
      return { label: "Unknown", color: "var(--border-strong, #555)", pulse: false };
  }
}
