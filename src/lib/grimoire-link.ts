"use client";

/**
 * Cross-surface deep links into the Grimoire.
 *
 * The Grimoire surface selects a document on entry from a
 * `#grimoire:<kind>:<id>` location hash (see grimoire-view.tsx). Other
 * surfaces — the memory reader, the chat inspector's memory tab — use these
 * helpers to land on a document: write the hash, then announce the mode
 * switch through the Workspace's `cave:navigate-mode` bridge.
 */

export type GrimoireDocKind = "knowledge" | "memory" | "journal";

export const GRIMOIRE_HASH_PREFIX = "#grimoire:";

/** The `#grimoire:<kind>:<id>` hash for a document. */
export function grimoireHash(kind: GrimoireDocKind, id: string): string {
  return `${GRIMOIRE_HASH_PREFIX}${kind}:${encodeURIComponent(id)}`;
}

/** Navigate the workspace to the Grimoire with the given document selected. */
export function openGrimoireDoc(kind: GrimoireDocKind, id: string): void {
  if (typeof window === "undefined") return;
  const base = window.location.pathname + window.location.search;
  window.history.replaceState(null, "", `${base}${grimoireHash(kind, id)}`);
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "grimoire" } }));
}
