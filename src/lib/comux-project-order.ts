"use client";

import type { ComuxProject } from "@/lib/comux-projects";

// Persisted explorer prefs, keyed by absolute project root (the stable id —
// names can collide, roots can't). Separate from the chat session order/pins
// (those key by session id) so the two never tug on each other.
const ORDER_KEY = "cave:comux:projectOrder";
const PINNED_KEY = "cave:comux:pinnedProjects";

function readRoots(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeRoots(key: string, roots: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...roots]));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export function readProjectOrder(): string[] {
  return readRoots(ORDER_KEY);
}
export function writeProjectOrder(order: readonly string[]): void {
  writeRoots(ORDER_KEY, order);
}
export function readPinnedProjects(): string[] {
  return readRoots(PINNED_KEY);
}
export function writePinnedProjects(pinned: readonly string[]): void {
  writeRoots(PINNED_KEY, pinned);
}

export function isProjectPinned(pinned: readonly string[], root: string): boolean {
  return pinned.includes(root);
}

export function toggleProjectPin(pinned: readonly string[], root: string): string[] {
  return pinned.includes(root) ? pinned.filter((r) => r !== root) : [...pinned, root];
}

/**
 * Order projects for display: apply the user's manual drag order first (roots
 * not in the order keep their incoming relative position, appended after the
 * ordered ones — so a freshly-created project shows up without needing an order
 * entry), then float pinned roots to the top preserving their relative order.
 *
 * Pure + stable: with no order and no pins it returns the input order unchanged.
 */
export function orderProjects(
  projects: readonly ComuxProject[],
  order: readonly string[],
  pinned: readonly string[],
): ComuxProject[] {
  const rank = new Map(order.map((root, i) => [root, i] as const));
  const indexed = projects.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => {
    const ra = rank.has(a.p.root) ? (rank.get(a.p.root) as number) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.p.root) ? (rank.get(b.p.root) as number) : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.i - b.i; // stable tie-break: keep incoming (recency) order
  });
  const ordered = indexed.map((x) => x.p);

  if (pinned.length === 0) return ordered;
  const pinnedSet = new Set(pinned);
  const head: ComuxProject[] = [];
  const tail: ComuxProject[] = [];
  for (const p of ordered) (pinnedSet.has(p.root) ? head : tail).push(p);
  return [...head, ...tail];
}
