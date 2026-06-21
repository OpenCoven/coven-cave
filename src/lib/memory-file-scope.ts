// Strict per-familiar scoping for memory FILE entries surfaced inside a chat
// session (the inspector/rail Memory tab). The rule mirrors `buildMemoryRows`'s
// file policy so the whole app agrees on what "this familiar's memory" means:
//
//   • owned   — the entry belongs to the active familiar's workspace.
//   • shared  — the entry has no familiar owner (global/runtime pools, e.g.
//               ~/.coven/memory, the OpenClaw workspace index, Codex runtime).
//   • foreign — the entry belongs to a DIFFERENT familiar. These are dropped:
//               a chat with familiar A must never surface familiar B's memory.
//
// This module is framework- and fs-free so it can run on the server (to scope
// `/api/memory?familiarId=` at the source) and on the client (to order + label
// rows) from a single, unit-tested source of truth.

export type MemoryOwnership = "owned" | "shared";

/** An entry with enough shape to be scoped — anything carrying `familiarId`. */
export type FamiliarScopable = { familiarId?: string | null };

export type ScopedMemoryEntry<T> = T & { ownership: MemoryOwnership };

export type MemoryScopeResult<T> = {
  /** Visible entries, owned first then shared; foreign entries excluded.
   *  Input order is preserved within each ownership group. */
  visible: ScopedMemoryEntry<T>[];
  ownedCount: number;
  sharedCount: number;
  /** How many entries were dropped because they belong to another familiar. */
  hiddenForeignCount: number;
};

function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Scope memory file `entries` to `activeFamiliarId`.
 *
 * When `activeFamiliarId` is empty/absent there is no familiar context to scope
 * against (e.g. the inspector with no familiar selected), so every entry is
 * returned and labelled `shared` and nothing is hidden — this is NOT a chat
 * session, so there is no cross-familiar boundary to enforce.
 *
 * When a familiar IS active (the chat-session case), foreign entries are
 * strictly excluded and the rest are labelled owned/shared and ordered
 * owned-first.
 */
export function scopeMemoryFilesToFamiliar<T extends FamiliarScopable>(
  entries: readonly T[],
  activeFamiliarId: string | null | undefined,
): MemoryScopeResult<T> {
  const active = normalizeId(activeFamiliarId);

  if (!active) {
    const visible = entries.map((e) => ({ ...e, ownership: "shared" as const }));
    return { visible, ownedCount: 0, sharedCount: visible.length, hiddenForeignCount: 0 };
  }

  const owned: ScopedMemoryEntry<T>[] = [];
  const shared: ScopedMemoryEntry<T>[] = [];
  let hiddenForeignCount = 0;

  for (const entry of entries) {
    const owner = normalizeId(entry.familiarId);
    if (owner === null) {
      shared.push({ ...entry, ownership: "shared" });
    } else if (owner === active) {
      owned.push({ ...entry, ownership: "owned" });
    } else {
      hiddenForeignCount += 1; // a different familiar's memory — never surfaced
    }
  }

  return {
    visible: [...owned, ...shared],
    ownedCount: owned.length,
    sharedCount: shared.length,
    hiddenForeignCount,
  };
}

/** Convenience: just the scoped, visible entries (owned + shared, ordered). */
export function visibleMemoryFilesForFamiliar<T extends FamiliarScopable>(
  entries: readonly T[],
  activeFamiliarId: string | null | undefined,
): ScopedMemoryEntry<T>[] {
  return scopeMemoryFilesToFamiliar(entries, activeFamiliarId).visible;
}
