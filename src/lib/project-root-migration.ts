"use client";

/**
 * Follow a project root that the server re-normalized (cave-2x1em).
 *
 * `createProject` has persisted an expanded root since cave-psp8, but records
 * written before that still hold a literal `~/code/app`. The same folder
 * therefore reached the client as two different strings depending on when it
 * was added, and roots are the KEYS of client-side stores — so an old project's
 * avatar and chat overrides were filed under a key nothing else produced.
 *
 * `loadProjectsUnlocked` now serves one expanded form and attaches `legacyRoot`
 * when it had to move one. This pass follows that move in the client's stores.
 * It cannot compute the mapping itself: expanding `~` needs a home directory,
 * and the browser has none — which is also why `normalizeProjectRoot` stays
 * deliberately non-expanding.
 *
 * WHAT IS AND IS NOT MIGRATED, checked against the code rather than the
 * original issue text:
 *   - IDB projectAvatars           keyed BY root      -> re-keyed
 *   - cave:chat:project-overrides  root is the VALUE  -> values rewritten
 *   - comux pins + order           does not exist. The comux surface was
 *     deleted (cave-c3yt); `deriveComuxProjects` survives but nothing persists
 *     pins or order, so there is no store to move.
 */

import { normalizeProjectRoot, type CaveProject } from "./cave-projects-types.ts";
import {
  moveProjectImageFromStorageKey,
  readProjectImagesSnapshot,
  whenProjectImagesHydrated,
} from "./cave-project-images.ts";
import { readProjectOverrides, writeProjectOverrides } from "./chat-project-overrides.ts";

/**
 * Re-key what the server moved. Returns how many roots were followed, which is
 * what makes idempotence observable: a second window running this immediately
 * after the first gets 0.
 *
 * Safe to run concurrently. Avatar moves write the new key before deleting the
 * old one, so a denied write (quota, private mode) leaves the record under its
 * old key rather than losing it. Overrides are read-modify-written whole; the
 * last writer wins with identical content.
 */
export async function migrateProjectRootKeys(
  projects: readonly CaveProject[],
): Promise<number> {
  const moves = projects
    .filter((project) => project.legacyRoot && project.legacyRoot !== project.root)
    .map((project) => ({ from: project.legacyRoot as string, to: project.root }));
  if (moves.length === 0) return 0;

  // Count what was actually FOLLOWED, not what was offered. The server keeps
  // attaching legacyRoot on every load until the projects file self-heals on
  // its next mutation, so a second window would otherwise report the same
  // migration again and idempotence would be unobservable — the count is the
  // only externally visible signal that this pass did nothing.
  // Per ROOT, not per store: a root that had both an avatar and an override
  // counts once. The number answers "how many roots did this pass follow",
  // which is what a caller logs and what makes a second pass observably 0.
  const followed = new Set<string>();

  // Wait for the image store before reading its snapshot. It hydrates
  // asynchronously on import, so an early read returns {} and every avatar
  // looks absent — the migration would skip a real one and report 0, which is
  // indistinguishable from "nothing to do".
  await whenProjectImagesHydrated();

  for (const { from, to } of moves) {
    // Probe the literal persisted key before the canonical store key. Most
    // historical writes normalized on entry, but pre-upgrade drive roots could
    // already exist under literal `C:`.
    const fromKeys = [...new Set([from, normalizeProjectRoot(from)])];
    for (const fromKey of fromKeys) {
      const hadImage = Object.hasOwn(readProjectImagesSnapshot(), fromKey);
      if (!hadImage) continue;
      // Probe the literal persisted key first: old drive roots could be stored
      // as `C:` before normalization canonicalized them to `C:/`.
      await moveProjectImageFromStorageKey(fromKey, to);
      if (!Object.hasOwn(readProjectImagesSnapshot(), fromKey)) followed.add(from);
    }
  }

  // One read-modify-write for every move, so a corrupt or absent map costs one
  // recovery rather than one per project. readProjectOverrides already returns
  // {} for both cases, so this cannot throw on a first run.
  const overrides = readProjectOverrides();
  let rewrote = false;
  const next = { ...overrides };
  for (const { from, to } of moves) {
    for (const [sessionId, root] of Object.entries(overrides)) {
      if (root !== from) continue;
      next[sessionId] = to;
      rewrote = true;
      followed.add(from);
    }
  }
  if (rewrote) writeProjectOverrides(next);

  return followed.size;
}
