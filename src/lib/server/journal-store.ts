import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { isValidNoteDate } from "@/lib/daily-note";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  entryPreview,
  formatJournalEntry,
  isEmptyEntry,
  parseJournalEntry,
  type JournalEntry,
} from "@/lib/journal";

/**
 * Filesystem layer for the personal Journal, used by /api/journal.
 *
 * Layout (both stay readable; nothing is migrated on read):
 *
 *   ~/.coven/journal/familiars/<familiarId>/<YYYY-MM-DD>.md   per-familiar (current)
 *   ~/.coven/journal/<YYYY-MM-DD>.md                          legacy, coven-wide
 *
 * The legacy layout held ONE file per day for the whole coven, so two
 * familiars reflecting on the same day overwrote each other. Every attributed
 * write now lands in the familiar's own directory; a legacy file is attributed
 * through its `reflectedBy` frontmatter, and is removed only after the same
 * familiar's per-familiar file for that date has been written (so a day never
 * lists twice). For a per-familiar file the DIRECTORY is the owner: its
 * `reflectedBy` always reads as that familiar, whatever the frontmatter says.
 *
 * User-controlled inputs are the date and the familiar id. The date is gated
 * on `isValidNoteDate` (`YYYY-MM-DD` real day — no separators or `..`) and the
 * familiar id on the shared `isValidFamiliarId` slug guard (no separators, no
 * dots). An invalid familiar id never builds a path: it can only match a
 * legacy file's frontmatter. Every path is re-checked to stay inside the
 * journal directory as an inline barrier for static analysis.
 */

export type JournalSource = "familiar" | "legacy";

export type JournalRecord = {
  date: string;
  exists: boolean;
  entry: JournalEntry;
  modified: string | null;
  /** Which layout holds the entry; null when there is no entry. */
  source: JournalSource | null;
};

export type JournalSummary = {
  date: string;
  preview: string;
  reflectedBy: string | null;
  modified: string | null;
  source: JournalSource;
};

const FAMILIARS_DIR = "familiars";

function journalDir(): string {
  return path.join(covenHome(), "journal");
}

function familiarsRoot(): string {
  return path.join(journalDir(), FAMILIARS_DIR);
}

function assertInside(dir: string, file: string): void {
  const rel = path.relative(dir, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("path not allowed");
}

/** True when `familiarId` can own a per-familiar journal directory. */
export function isJournalFamiliarId(familiarId: unknown): familiarId is string {
  return typeof familiarId === "string" && isValidFamiliarId(familiarId);
}

/** `~/.coven/journal/familiars/<familiarId>` — throws on an invalid id. */
export function familiarJournalDir(familiarId: string): string {
  if (!isJournalFamiliarId(familiarId)) throw new Error("invalid familiar id");
  const root = familiarsRoot();
  const dir = path.join(root, path.basename(familiarId));
  assertInside(root, dir);
  return dir;
}

/** Create (if needed) and return the familiar's journal directory. */
export async function ensureFamiliarJournalDir(familiarId: string): Promise<string> {
  const dir = familiarJournalDir(familiarId);
  await mkdir(dir, { recursive: true });
  return dir;
}

function legacyEntryFile(date: string): string {
  if (!isValidNoteDate(date)) throw new Error("invalid journal date");
  const dir = journalDir();
  const file = path.join(dir, `${path.basename(date)}.md`);
  assertInside(dir, file);
  return file;
}

function familiarEntryFile(date: string, familiarId: string): string {
  if (!isValidNoteDate(date)) throw new Error("invalid journal date");
  const dir = familiarJournalDir(familiarId);
  const file = path.join(dir, `${path.basename(date)}.md`);
  assertInside(dir, file);
  return file;
}

const EMPTY: JournalEntry = { reflectedBy: null, generatedAt: null, reflection: "" };

function emptyRecord(date: string): JournalRecord {
  return { date, exists: false, entry: { ...EMPTY }, modified: null, source: null };
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

/** Read one journal file; null when it does not exist. Other fs errors throw. */
async function readEntryFile(
  file: string,
  date: string,
  source: JournalSource,
  owner: string | null,
): Promise<JournalRecord | null> {
  try {
    const [raw, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const entry = parseJournalEntry(raw);
    // A per-familiar file belongs to its directory's familiar.
    if (owner) entry.reflectedBy = owner;
    return { date, exists: true, entry, modified: info.mtime.toISOString(), source };
  } catch (error) {
    if (isMissingPath(error)) return null;
    throw error;
  }
}

function readLegacy(date: string): Promise<JournalRecord | null> {
  return readEntryFile(legacyEntryFile(date), date, "legacy", null);
}

function readFamiliarFile(date: string, familiarId: string): Promise<JournalRecord | null> {
  return readEntryFile(familiarEntryFile(date, familiarId), date, "familiar", familiarId);
}

async function unlinkIfPresent(file: string): Promise<boolean> {
  try {
    await unlink(file);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

/** Valid familiar ids that have a journal directory (sorted, deterministic). */
async function listFamiliarDirs(): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(familiarsRoot());
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }
  return names.filter((name) => isJournalFamiliarId(name)).sort();
}

/**
 * Read the entry for `date`.
 *
 * With `familiarId`: that familiar's own file, else a legacy file whose
 * `reflectedBy` is that familiar, else an empty record. Another familiar's
 * entry is never returned.
 *
 * Without `familiarId` (date-only callers such as the Grimoire reader): the
 * legacy file when present; otherwise the MOST RECENTLY MODIFIED per-familiar
 * file for that date, ties broken by familiar id ascending, so the choice is
 * deterministic.
 */
export async function readJournalEntry(date: string, familiarId?: string | null): Promise<JournalRecord> {
  if (!isValidNoteDate(date)) throw new Error("invalid journal date");
  if (familiarId) {
    if (isJournalFamiliarId(familiarId)) {
      const own = await readFamiliarFile(date, familiarId);
      if (own) return own;
    }
    const legacy = await readLegacy(date);
    return legacy && legacy.entry.reflectedBy === familiarId ? legacy : emptyRecord(date);
  }
  const legacy = await readLegacy(date);
  if (legacy) return legacy;
  let best: JournalRecord | null = null;
  for (const id of await listFamiliarDirs()) {
    const record = await readFamiliarFile(date, id);
    if (!record) continue;
    // Familiar dirs are walked in ascending id order, so a strict `>` keeps
    // the lowest id on an mtime tie.
    if (!best || (record.modified ?? "") > (best.modified ?? "")) best = record;
  }
  return best ?? emptyRecord(date);
}

/**
 * The record a write of `(date, reflectedBy)` would replace — what the POST
 * route's optimistic-concurrency guard and generatedAt preservation compare
 * against. A valid familiar resolves like `readJournalEntry(date, familiar)`;
 * an unattributed (or non-slug) author only ever touches the legacy file.
 */
export async function readJournalWriteTarget(date: string, reflectedBy: string | null): Promise<JournalRecord> {
  if (isJournalFamiliarId(reflectedBy)) return readJournalEntry(date, reflectedBy);
  if (!isValidNoteDate(date)) throw new Error("invalid journal date");
  return (await readLegacy(date)) ?? emptyRecord(date);
}

/**
 * Persist an entry. An attributed entry (valid `reflectedBy`) is written to
 * the familiar's own file and, once that write succeeded, a legacy file for
 * the same date AND the same familiar is removed so the day never lists twice.
 * An unattributed entry keeps the legacy behaviour (coven-wide file). A blank
 * reflection deletes instead of writing an empty file.
 */
export async function writeJournalEntry(date: string, entry: JournalEntry): Promise<JournalRecord> {
  if (!isValidNoteDate(date)) throw new Error("invalid journal date");
  const familiarId = isJournalFamiliarId(entry.reflectedBy) ? entry.reflectedBy : null;
  if (isEmptyEntry(entry)) {
    if (familiarId) await deleteJournalEntry(date, familiarId);
    else await unlinkIfPresent(legacyEntryFile(date));
    return emptyRecord(date);
  }
  if (!familiarId) {
    const file = legacyEntryFile(date);
    await mkdir(journalDir(), { recursive: true });
    await writeFile(file, formatJournalEntry(entry), "utf8");
    const info = await stat(file);
    return { date, exists: true, entry, modified: info.mtime.toISOString(), source: "legacy" };
  }
  const file = familiarEntryFile(date, familiarId);
  await ensureFamiliarJournalDir(familiarId);
  await writeFile(file, formatJournalEntry(entry), "utf8");
  const info = await stat(file);
  // Best-effort: the write already succeeded, and a legacy row that survives
  // a failed cleanup is still shadowed by this file in `listJournalEntries`.
  try {
    const legacy = await readLegacy(date);
    if (legacy && legacy.entry.reflectedBy === familiarId) await unlinkIfPresent(legacyEntryFile(date));
  } catch {
    // leave the legacy file; it is shadowed, not duplicated
  }
  return { date, exists: true, entry, modified: info.mtime.toISOString(), source: "familiar" };
}

/**
 * Delete an entry.
 *
 * With `familiarId`: that familiar's own file plus any legacy file it owns
 * (by `reflectedBy`) for the date — never another familiar's entry.
 * Without: whichever file `readJournalEntry(date)` resolves to, so a
 * date-only reader deletes exactly what it showed.
 */
export async function deleteJournalEntry(date: string, familiarId?: string | null): Promise<boolean> {
  if (!isValidNoteDate(date)) throw new Error("invalid journal date");
  if (familiarId) {
    let deleted = false;
    if (isJournalFamiliarId(familiarId)) {
      deleted = await unlinkIfPresent(familiarEntryFile(date, familiarId));
    }
    const legacy = await readLegacy(date);
    if (legacy && legacy.entry.reflectedBy === familiarId) {
      deleted = (await unlinkIfPresent(legacyEntryFile(date))) || deleted;
    }
    return deleted;
  }
  const record = await readJournalEntry(date);
  if (!record.exists) return false;
  if (record.source === "familiar" && isJournalFamiliarId(record.entry.reflectedBy)) {
    return unlinkIfPresent(familiarEntryFile(date, record.entry.reflectedBy));
  }
  return unlinkIfPresent(legacyEntryFile(date));
}

function dateFiles(names: readonly string[]): string[] {
  return names
    .filter((name) => name.endsWith(".md") && isValidNoteDate(name.slice(0, -3)))
    .map((name) => name.slice(0, -3));
}

function toSummary(record: JournalRecord, source: JournalSource): JournalSummary {
  return {
    date: record.date,
    preview: entryPreview(record.entry),
    reflectedBy: record.entry.reflectedBy,
    modified: record.modified,
    source,
  };
}

/**
 * List every saved entry with a one-line preview: the union of the
 * per-familiar directories and the legacy files. A day can carry several rows
 * (one per familiar), so the row identity is `(date, reflectedBy)`. When a
 * familiar has both a per-familiar file and a legacy file for the same date,
 * the per-familiar file wins and the legacy row is dropped.
 *
 * `familiarId` narrows to that familiar's rows. Sorted newest date first, then
 * by familiar id (unattributed legacy rows first on a tie).
 */
export async function listJournalEntries(familiarId?: string | null): Promise<JournalSummary[]> {
  let legacyNames: string[];
  try {
    legacyNames = await readdir(journalDir());
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }

  const familiarIds = (await listFamiliarDirs()).filter((id) => !familiarId || id === familiarId);
  const familiarRows = (
    await Promise.all(
      familiarIds.map(async (id) => {
        let names: string[];
        try {
          names = await readdir(familiarJournalDir(id));
        } catch (error) {
          // A stray non-directory entry under familiars/ is not a journal.
          if (isMissingPath(error) || (error as { code?: unknown })?.code === "ENOTDIR") return [];
          throw error;
        }
        const rows = await Promise.all(
          dateFiles(names).map(async (date) => {
            const record = await readFamiliarFile(date, id);
            return record ? toSummary(record, "familiar") : null;
          }),
        );
        return rows.filter((row): row is JournalSummary => row !== null);
      }),
    )
  ).flat();

  const owned = new Set(familiarRows.map((row) => `${row.date}\u0000${row.reflectedBy}`));
  const legacyRows = (
    await Promise.all(
      dateFiles(legacyNames).map(async (date) => {
        const record = await readLegacy(date);
        if (!record) return null;
        if (familiarId && record.entry.reflectedBy !== familiarId) return null;
        if (record.entry.reflectedBy && owned.has(`${date}\u0000${record.entry.reflectedBy}`)) return null;
        return toSummary(record, "legacy");
      }),
    )
  ).filter((row): row is JournalSummary => row !== null);

  return [...familiarRows, ...legacyRows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const fa = a.reflectedBy ?? "";
    const fb = b.reflectedBy ?? "";
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });
}
