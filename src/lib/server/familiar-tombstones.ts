import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "./atomic-write";
import {
  normalizeTombstones,
  pruneTombstones,
  type RemovedFamiliarTombstone,
} from "@/lib/familiar-removal";

/**
 * $COVEN_HOME/cave-removed-familiars.json (defaulting to ~/.coven) — tombstones
 * for removed familiars.
 * DELETE /api/familiars/[id] snapshots an entry here BEFORE mutating
 * familiars.toml / cave-config.json; POST /api/familiars/removed restores
 * from it, and the roster GET hides tombstoned ids until the daemon has
 * re-read familiars.toml.
 */
function storePath(): string {
  return path.join(covenHome(), "cave-removed-familiars.json");
}

export async function readTombstones(now = Date.now()): Promise<RemovedFamiliarTombstone[]> {
  let raw: string;
  try {
    raw = await readFile(storePath(), "utf8");
  } catch {
    return []; // absent — nothing removed yet
  }
  try {
    return pruneTombstones(normalizeTombstones(JSON.parse(raw)), now);
  } catch {
    return []; // corrupt store reads as empty; the next write repairs it
  }
}

async function writeTombstones(entries: RemovedFamiliarTombstone[]): Promise<void> {
  await mkdir(path.dirname(storePath()), { recursive: true });
  await writeJsonAtomic(storePath(), { entries });
}

export async function addTombstone(entry: RemovedFamiliarTombstone): Promise<void> {
  const rest = (await readTombstones()).filter((existing) => existing.id !== entry.id);
  await writeTombstones(pruneTombstones([entry, ...rest], Date.now()));
}

/** Remove and return the tombstone for `id`, or null when none exists. */
export async function takeTombstone(id: string): Promise<RemovedFamiliarTombstone | null> {
  const entries = await readTombstones();
  const entry = entries.find((existing) => existing.id === id) ?? null;
  if (entry) await writeTombstones(entries.filter((existing) => existing.id !== id));
  return entry;
}

/** Ids the roster GET must hide until the daemon re-reads familiars.toml. */
export async function removedFamiliarIds(): Promise<Set<string>> {
  return new Set((await readTombstones()).map((entry) => entry.id));
}
