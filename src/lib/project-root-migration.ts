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

import type { CaveProject } from "./cave-projects-types.ts";
import { moveProjectImage, readProjectImagesSnapshot } from "./cave-project-images.ts";
import { readProjectOverrides, writeProjectOverrides } from "./chat-project-overrides.ts";

/**
 * Re-key what the server moved. Returns how many roots were followed, which is
 * what makes idempotence observable: a second window running this immediately
 * after the first gets 0.
 *
 * Safe to run concurrently. Avatars go through `moveProjectImage`, which writes
 * the new key before deleting the old one, so a denied write (quota, private
 * mode) leaves the record under its old key rather than losing it. Overrides
 * are read-modify-written whole; the last writer wins with identical content.
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

  for (const { from, to } of moves) {
    const hadImage = Object.hasOwn(readProjectImagesSnapshot(), from);
    if (hadImage) {
      // Failures are swallowed inside moveProjectImage — it writes the new key
      // first and deletes the old only on success, so a denied write leaves the
      // record under its old key rather than losing it.
      await moveProjectImage(from, to);
      if (!Object.hasOwn(readProjectImagesSnapshot(), from)) followed.add(from);
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
