/**
 * Pure data-shaping helpers for the chat-avatar inline card.
 * No React, no fetch — unit-tested in familiar-card-data.test.ts.
 */

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
  /** basename of relPath, used as the row title */
  title: string;
  excerpt: string;
  modified: string;
  fullPath: string;
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

/** Filter memory entries to one familiar, newest-first, limited, mapped. */
export function pickFamiliarMemory(
  entries: RawMemoryEntry[],
  familiarId: string,
  limit = 3,
): MemoryPeekEntry[] {
  return entries
    .filter((e) => e.familiarId === familiarId)
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
    .slice(0, limit)
    .map((e) => ({
      title: basename(e.relPath),
      excerpt: e.excerpt ?? "",
      modified: e.modified,
      fullPath: e.fullPath,
    }));
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
