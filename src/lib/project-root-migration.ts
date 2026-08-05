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
 * `loadProjectsUnlocked` now serves one expanded form and attaches every
 * pre-canonical key as `legacyRoots`. This pass follows those moves in the
 * client's stores.
 * It cannot compute the mapping itself: expanding `~` needs a home directory,
 * and the browser has none — which is also why `normalizeProjectRoot` stays
 * deliberately non-expanding.
 *
 * WHAT IS AND IS NOT MIGRATED, checked against the code rather than the
 * original issue text:
 *   - IDB projectAvatars           keyed BY root      -> re-keyed
 *   - cave:chat:project-overrides  root is the VALUE  -> values rewritten
 *   - cave:project-frecency:v1     root is the KEY    -> re-keyed and merged
 *   - cave:group-chat:groups       project id value    -> losing ids rewritten
 *   - cave:chat:new-session-defaults project id value  -> losing id rewritten
 *   - cave:chat project selection  project id values   -> losing ids rewritten
 *   - comux pins + order           does not exist. The comux surface was
 *     deleted (cave-c3yt); `deriveComuxProjects` survives but nothing persists
 *     pins or order, so there is no store to move.
 */

import {
  normalizeProjectRoot,
  projectIdMigrationMap,
  type CaveProject,
} from "./cave-projects-types.ts";
import {
  hydrateProjectImagesForMigration,
  moveProjectImageFromStorageKey,
} from "./cave-project-images.ts";
import {
  readProjectOverridesForMigration,
  writeProjectOverridesForMigration,
} from "./chat-project-overrides.ts";
import { migrateStoredGroupProjectIds } from "./group-chat.ts";
import { migrateStoredNewSessionProjectId } from "./chat-new-session-defaults.ts";
import { migrateStoredProjectSelectionIds } from "./chat-project-selection.ts";
import { migrateStoredProjectFrecencyRoots } from "./project-frecency.ts";

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
  const idMigrations = projectIdMigrationMap(projects);
  if (typeof window !== "undefined" && idMigrations.size > 0) {
    migrateStoredGroupProjectIds(window.localStorage, idMigrations);
    migrateStoredNewSessionProjectId(window.localStorage, idMigrations);
    migrateStoredProjectSelectionIds(window.localStorage, idMigrations);
  }
  const seenMoves = new Set<string>();
  const moves = projects.flatMap((project) => {
    const aliases = new Set([
      ...(project.legacyRoots ?? []),
      ...(project.legacyRoot ? [project.legacyRoot] : []),
    ]);
    return [...aliases].flatMap((from) => {
      if (!from || from === project.root) return [];
      const identity = JSON.stringify([from, project.root]);
      if (seenMoves.has(identity)) return [];
      seenMoves.add(identity);
      return [{ from, to: project.root }];
    });
  });
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

  // Migration cannot use the UI's tolerant hydration: unreadable IndexedDB
  // must reject so the caller retains server aliases for a later retry.
  const migrationImages = await hydrateProjectImagesForMigration();

  for (const { from, to } of moves) {
    // Probe the literal persisted key before the canonical store key. Most
    // historical writes normalized on entry, but pre-upgrade drive roots could
    // already exist under literal `C:`.
    const fromKeys = [...new Set([from, normalizeProjectRoot(from)])];
    for (const fromKey of fromKeys) {
      const hadImage = Object.hasOwn(migrationImages, fromKey);
      // Probe the literal persisted key first: old drive roots could be stored
      // as `C:` before normalization canonicalized them to `C:/`.
      const result = await moveProjectImageFromStorageKey(fromKey, to);
      if (!result) continue;
      const sourceKey = result.sourceKey || fromKey;
      if (result.source) migrationImages[sourceKey] = result.source;
      else delete migrationImages[sourceKey];
      if (sourceKey !== fromKey) delete migrationImages[fromKey];
      const toKey = result.destinationKey || normalizeProjectRoot(to);
      if (result.destination) migrationImages[toKey] = result.destination;
      else delete migrationImages[toKey];
      if (hadImage && !Object.hasOwn(migrationImages, fromKey)) followed.add(from);
    }
  }

  // One read-modify-write for every move, so a corrupt or absent map costs one
  // recovery rather than one per project. Corrupt data is treated as empty;
  // storage denial throws so the server keeps the aliases for a later retry.
  const overrides = readProjectOverridesForMigration();
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
  if (rewrote) writeProjectOverridesForMigration(next);
  if (typeof window !== "undefined") {
    for (const from of migrateStoredProjectFrecencyRoots(window.localStorage, moves)) {
      followed.add(from);
    }
  }

  return followed.size;
}

export type ProjectRootMigrationAcknowledgement = {
  projectId: string;
  legacyRoots: string[];
};

export function projectRootMigrationAcknowledgements(
  projects: readonly CaveProject[],
): ProjectRootMigrationAcknowledgement[] {
  return projects.flatMap((project) => {
    const legacyRoots = [
      ...new Set([
        ...(project.legacyRoots ?? []),
        ...(project.legacyRoot ? [project.legacyRoot] : []),
      ]),
    ].filter((root) => root && root !== project.root);
    return legacyRoots.length
      ? [{ projectId: project.id, legacyRoots }]
      : [];
  });
}

async function acknowledgeProjectRootMigrations(
  acknowledgements: readonly ProjectRootMigrationAcknowledgement[],
): Promise<void> {
  const response = await fetch("/api/projects", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "acknowledge-root-migrations",
      migrations: acknowledgements,
    }),
  });
  if (!response.ok) {
    throw new Error(`project root migration acknowledgment failed: HTTP ${response.status}`);
  }
}

export async function migrateAndAcknowledgeProjectRoots(
  projects: readonly CaveProject[],
  dependencies: {
    migrate?: (projects: readonly CaveProject[]) => Promise<number>;
    acknowledge?: (
      acknowledgements: readonly ProjectRootMigrationAcknowledgement[],
    ) => Promise<void>;
  } = {},
): Promise<number> {
  const acknowledgements = projectRootMigrationAcknowledgements(projects);
  const migrated = await (dependencies.migrate ?? migrateProjectRootKeys)(projects);
  if (acknowledgements.length) {
    await (dependencies.acknowledge ?? acknowledgeProjectRootMigrations)(
      acknowledgements,
    );
  }
  return migrated;
}
