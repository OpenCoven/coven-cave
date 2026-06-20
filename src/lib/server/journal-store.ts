import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { isValidNoteDate } from "@/lib/daily-note";
import {
  entryPreview,
  formatJournalEntry,
  isEmptyEntry,
  parseJournalEntry,
  type JournalEntry,
} from "@/lib/journal";

/**
 * Filesystem layer for the personal Journal, used by /api/journal. The only
 * user-controlled input is the date, constrained by `isValidNoteDate`
 * (`YYYY-MM-DD` real day — no separators or `..`), so the filename can't escape
 * the journal directory. The path is re-checked to stay inside it as an inline
 * barrier for static analysis.
 */

export type JournalRecord = {
  date: string;
  exists: boolean;
  entry: JournalEntry;
  modified: string | null;
};

export type JournalSummary = {
  date: string;
  preview: string;
  reflectedBy: string | null;
  modified: string | null;
};

function journalDir(): string {
  return path.join(covenHome(), "journal");
}

function entryFile(date: string): string {
  if (!isValidNoteDate(date)) throw new Error("invalid journal date");
  const dir = journalDir();
  const file = path.join(dir, `${path.basename(date)}.md`);
  if (path.relative(dir, file).startsWith("..")) throw new Error("path not allowed");
  return file;
}

const EMPTY: JournalEntry = { reflectedBy: null, generatedAt: null, reflection: "" };

export async function readJournalEntry(date: string): Promise<JournalRecord> {
  const file = entryFile(date);
  try {
    const [raw, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    return { date, exists: true, entry: parseJournalEntry(raw), modified: info.mtime.toISOString() };
  } catch {
    return { date, exists: false, entry: { ...EMPTY }, modified: null };
  }
}

export async function writeJournalEntry(date: string, entry: JournalEntry): Promise<JournalRecord> {
  const file = entryFile(date);
  if (isEmptyEntry(entry)) {
    await deleteJournalEntry(date);
    return { date, exists: false, entry: { ...EMPTY }, modified: null };
  }
  await mkdir(journalDir(), { recursive: true });
  await writeFile(file, formatJournalEntry(entry), "utf8");
  const info = await stat(file);
  return { date, exists: true, entry, modified: info.mtime.toISOString() };
}

export async function deleteJournalEntry(date: string): Promise<boolean> {
  const file = entryFile(date);
  try {
    await unlink(file);
    return true;
  } catch {
    return false;
  }
}

/** List every day with a saved entry, newest first, with a one-line preview. */
export async function listJournalEntries(): Promise<JournalSummary[]> {
  let names: string[];
  try {
    names = await readdir(journalDir());
  } catch {
    return [];
  }
  const summaries = await Promise.all(
    names
      .filter((name) => name.endsWith(".md") && isValidNoteDate(name.slice(0, -3)))
      .map(async (name) => {
        const record = await readJournalEntry(name.slice(0, -3));
        const summary: JournalSummary = {
          date: record.date,
          preview: entryPreview(record.entry),
          reflectedBy: record.entry.reflectedBy,
          modified: record.modified,
        };
        return summary;
      }),
  );
  return summaries.sort((a, b) => (a.date < b.date ? 1 : -1));
}
