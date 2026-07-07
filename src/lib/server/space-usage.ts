/**
 * Bounded local space-usage scan for the dashboard cockpit.
 *
 * Walks a fixed allow-list of `~/.coven` areas (never arbitrary paths) and
 * reports bytes / file counts / recency per area. The walk is bounded — entry
 * and depth caps per area — so a pathological directory can't hang the
 * dashboard; a capped area is reported `truncated: true` rather than lying
 * with a silently-partial number. Symlinks are never followed (a link out of
 * `~/.coven` must not pull external trees into the tally).
 */

import { readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";

export type SpaceUsageArea = {
  /** Stable id the client maps to a label + cleanup action. */
  id: string;
  label: string;
  /** Path scanned, relative to the coven home (for display). */
  relPath: string;
  exists: boolean;
  bytes: number;
  files: number;
  /** Most recent file mtime in the area (epoch ms), or null when empty. */
  lastModifiedMs: number | null;
  /** True when the walk hit an entry/depth cap — figures are a lower bound. */
  truncated: boolean;
};

/** Fixed allow-list of scanned areas. `dir` is relative to the coven home;
 *  `filesOnly` limits the walk to the top-level plain files (app-state JSON). */
const AREAS: { id: string; label: string; dir: string; filesOnly?: boolean }[] = [
  { id: "conversations", label: "Chat transcripts", dir: "cave-conversations" },
  { id: "workspaces", label: "Familiar workspaces", dir: "workspaces" },
  { id: "memory", label: "Familiar memory", dir: "memory" },
  { id: "knowledge", label: "Knowledge vault", dir: "knowledge" },
  { id: "journal", label: "Journal", dir: "journal" },
  { id: "flows", label: "Flows", dir: "flows" },
  { id: "prompts", label: "Prompt templates", dir: "prompts" },
  { id: "skills", label: "Skills", dir: "skills" },
  { id: "trash", label: "Trash", dir: ".trash" },
  { id: "state", label: "App state", dir: ".", filesOnly: true },
];

const MAX_ENTRIES_PER_AREA = 20_000;
const MAX_DEPTH = 10;

type WalkTally = { bytes: number; files: number; lastModifiedMs: number | null; truncated: boolean };

async function walk(root: string, filesOnly: boolean): Promise<WalkTally | null> {
  const tally: WalkTally = { bytes: 0, files: 0, lastModifiedMs: null, truncated: false };
  let visited = 0;
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];

  // Confirm the root exists (and is a real directory, not a symlink).
  try {
    const st = await lstat(root);
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }

  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable subdir: skip, keep the rest of the tally honest
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (++visited > MAX_ENTRIES_PER_AREA) {
        tally.truncated = true;
        return tally;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (filesOnly) continue;
        if (depth + 1 > MAX_DEPTH) {
          tally.truncated = true;
          continue;
        }
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const st = await lstat(full);
        tally.bytes += st.size;
        tally.files += 1;
        const mtime = st.mtimeMs;
        if (tally.lastModifiedMs === null || mtime > tally.lastModifiedMs) tally.lastModifiedMs = mtime;
      } catch {
        // raced deletion: skip
      }
    }
  }
  return tally;
}

/** Scan every allow-listed area under `home` (defaults to the coven home). */
export async function collectSpaceUsage(home = covenHome()): Promise<SpaceUsageArea[]> {
  return Promise.all(
    AREAS.map(async (area): Promise<SpaceUsageArea> => {
      const root = area.dir === "." ? home : path.join(home, area.dir);
      const tally = await walk(root, area.filesOnly ?? false);
      return {
        id: area.id,
        label: area.label,
        relPath: area.dir === "." ? "~/.coven" : `~/.coven/${area.dir}`,
        exists: tally !== null,
        bytes: tally?.bytes ?? 0,
        files: tally?.files ?? 0,
        lastModifiedMs: tally?.lastModifiedMs ?? null,
        truncated: tally?.truncated ?? false,
      };
    }),
  );
}
