import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { familiarWorkspace } from "@/lib/coven-paths";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  formatDailyNote,
  isEmptyNote,
  isValidNoteDate,
  notePreview,
  parseDailyNote,
  type DailyNote,
} from "@/lib/daily-note";

/**
 * Filesystem layer for a familiar's Daily Notes, used by
 * /api/familiars/[id]/notes.
 *
 * The two user-controlled inputs — the familiar `id` and the date — are each
 * interpolated into a filesystem path. Both are constrained by strict allow-list
 * guards (`isValidFamiliarId` → slug, `isValidNoteDate` → `YYYY-MM-DD` real day);
 * neither can contain a path separator or `..`, so this can't become an
 * arbitrary-read/write primitive. Every fs-touching helper re-asserts the guards
 * as inline barriers, and the resolved path is checked to stay inside the
 * familiar's notes directory.
 */

export type DailyNoteRecord = {
  date: string;
  exists: boolean;
  note: DailyNote;
  modified: string | null;
};

export type DailyNoteSummary = {
  date: string;
  preview: string;
  hasReflection: boolean;
  modified: string | null;
};

async function notesDir(id: string): Promise<string> {
  if (!isValidFamiliarId(id)) throw new Error("invalid familiar id");
  const workspace = await familiarWorkspace(id);
  return path.join(workspace, "notes");
}

/** Resolve the on-disk file for one day's note, asserting it stays within the notes dir. */
async function noteFile(id: string, date: string): Promise<{ dir: string; file: string }> {
  if (!isValidFamiliarId(id)) throw new Error("invalid familiar id");
  if (!isValidNoteDate(date)) throw new Error("invalid note date");
  const dir = await notesDir(id);
  // `date` is a validated YYYY-MM-DD slug (no separators / `..`), so basename is a
  // no-op barrier that documents the invariant for static analysis.
  const file = path.join(dir, `${path.basename(date)}.md`);
  if (path.relative(dir, file).startsWith("..")) throw new Error("path not allowed");
  return { dir, file };
}

export async function readDailyNote(id: string, date: string): Promise<DailyNoteRecord> {
  const { file } = await noteFile(id, date);
  try {
    const [raw, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    return { date, exists: true, note: parseDailyNote(raw), modified: info.mtime.toISOString() };
  } catch {
    return { date, exists: false, note: { notes: "", reflection: "" }, modified: null };
  }
}

export async function writeDailyNote(id: string, date: string, note: DailyNote): Promise<DailyNoteRecord> {
  const { dir, file } = await noteFile(id, date);
  // An emptied note deletes its file rather than leaving an empty husk behind.
  if (isEmptyNote(note)) {
    await deleteDailyNote(id, date);
    return { date, exists: false, note: { notes: "", reflection: "" }, modified: null };
  }
  await mkdir(dir, { recursive: true });
  await writeFile(file, formatDailyNote(date, note), "utf8");
  const info = await stat(file);
  return { date, exists: true, note, modified: info.mtime.toISOString() };
}

export async function deleteDailyNote(id: string, date: string): Promise<boolean> {
  const { file } = await noteFile(id, date);
  try {
    await unlink(file);
    return true;
  } catch {
    return false;
  }
}

/** List every day that has a saved note, newest first, with a one-line preview. */
export async function listDailyNotes(id: string): Promise<DailyNoteSummary[]> {
  const dir = await notesDir(id);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const summaries = await Promise.all(
    names
      .filter((name) => name.endsWith(".md") && isValidNoteDate(name.slice(0, -3)))
      .map(async (name) => {
        const date = name.slice(0, -3);
        const record = await readDailyNote(id, date);
        const summary: DailyNoteSummary = {
          date,
          preview: notePreview(record.note),
          hasReflection: Boolean(record.note.reflection.trim()),
          modified: record.modified,
        };
        return summary;
      }),
  );

  return summaries.sort((a, b) => (a.date < b.date ? 1 : -1));
}
