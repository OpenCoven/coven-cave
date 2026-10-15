import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { listConversations, loadConversation } from "../cave-conversations.ts";
import { familiarWorkspace } from "../coven-paths.ts";
import { isProjectlessGenerationOrigin } from "../chat-origins.ts";
import { buildActivityDigest, excerptOf, formatDailyNote, isValidNoteDate } from "../daily-note.ts";
import { extractNextPaths } from "../next-paths.ts";
import { isValidFamiliarId } from "./familiar-id.ts";
import { listDailyNotes, readDailyNote } from "./familiar-notes.ts";

export type DailyNoteActivity = { date: string; digest: string; context: string; exists: boolean };
type Dependencies = { list: typeof listConversations; load: typeof loadConversation };
type ActivityArgs = { id: string; from: string; to: string; now?: Date; dependencies?: Dependencies };

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Inclusive, bounded calendar range; no DST-duration arithmetic. */
export function validateNoteRange(from: string, to: string, now = new Date()): void {
  if (!isValidNoteDate(from) || !isValidNoteDate(to) || from > to || to > localDay(now) ||
      (Date.parse(to) - Date.parse(from)) / 86_400_000 >= 31) {
    throw new Error("Choose up to 31 days, ending today or earlier.");
  }
}

/** Positive evidence only. Note generation itself is never eligible activity.
 * Memory mtime proves only its latest change; it cannot reconstruct older edits. */
export async function collectDailyNoteActivity(args: ActivityArgs): Promise<DailyNoteActivity[]> {
  if (!isValidFamiliarId(args.id)) throw new Error("Invalid familiar id.");
  validateNoteRange(args.from, args.to, args.now);
  const dependencies = args.dependencies ?? { list: listConversations, load: loadConversation };
  const days = new Map<string, { sessions: { title: string; harness?: string }[]; memory: { file: string; excerpt: string }[]; evidence: string[] }>();
  const inRange = (date: string) => date >= args.from && date <= args.to;
  const day = (date: string) => {
    let value = days.get(date);
    if (!value) { value = { sessions: [], memory: [], evidence: [] }; days.set(date, value); }
    return value;
  };
  const summaries = await dependencies.list();
  for (const summary of summaries) {
    if (summary.familiarId !== args.id || isProjectlessGenerationOrigin(summary.origin)) continue;
    // updatedAt is only a scan bound, never evidence of activity on that day.
    if (summary.updatedAt && localDay(new Date(summary.updatedAt)) < args.from) continue;
    const conversation = await dependencies.load(summary.sessionId);
    if (!conversation) throw new Error("Couldn't read chat activity. Retry before generating notes.");
    if (conversation.familiarId !== args.id || isProjectlessGenerationOrigin(conversation.origin)) continue;
    const seen = new Set<string>();
    for (const turn of conversation.turns) {
      if (turn.role !== "assistant" || !Number.isFinite(Date.parse(turn.createdAt))) continue;
      if (!turn.text.trim() && !turn.tools?.length) continue;
      const date = localDay(new Date(turn.createdAt));
      if (!inRange(date)) continue;
      const entry = day(date);
      if (!seen.has(date)) {
        entry.sessions.push({ title: conversation.title || summary.title || "Untitled chat", harness: conversation.harness });
        seen.add(date);
      }
      // Bound prompt context while retaining all positive activity days.
      if (entry.evidence.length < 20) entry.evidence.push(`${turn.createdAt}: ${turn.text.slice(0, 1200) || "Tool activity recorded."}`);
    }
  }
  const workspace = await familiarWorkspace(args.id);
  const memoryRoot = path.join(workspace, "memory");
  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const info = await stat(/* turbopackIgnore: true */ file);
        const date = localDay(info.mtime);
        if (!inRange(date)) continue;
        // Avoid reading arbitrary binaries or unbounded memory files into prompts.
        const excerpt = /\.(md|txt)$/i.test(entry.name) && info.size <= 128_000
          ? excerptOf(await readFile(/* turbopackIgnore: true */ file, "utf8")) : "";
        day(date).memory.push({ file: path.relative(memoryRoot, file), excerpt });
      }
    }
  }
  await walk(memoryRoot);
  const existing = new Set((await listDailyNotes(args.id)).map((note) => note.date));
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => {
    const digest = buildActivityDigest(value.sessions, value.memory);
    return { date, digest, context: `${digest}\n\nRecorded activity excerpts (partial):\n${value.evidence.join("\n\n")}`, exists: existing.has(date) };
  });
}

export async function dailyNoteContinuity(id: string, date: string): Promise<string> {
  const previous = (await listDailyNotes(id)).find((note) => note.date < date);
  if (!previous) return "No earlier daily note is saved.";
  const record = await readDailyNote(id, previous.date);
  return `Previous note (${previous.date}):\n${record.note.reflection.slice(0, 6000) || record.note.notes.slice(0, 6000)}`;
}

/** Publish a complete file without replacing a concurrent author or generator.
 * A hard link is atomic and fails EEXIST; unlike rename it never overwrites. */
export async function saveGeneratedDailyNote(args: Omit<ActivityArgs, "from" | "to"> & { date: string; reflection: string }) {
  if (!isValidFamiliarId(args.id)) throw new Error("Invalid familiar id.");
  validateNoteRange(args.date, args.date, args.now);
  const reflection = extractNextPaths(args.reflection).visible.trim();
  if (!reflection || reflection.length > 50_000) throw new Error("The reflection must contain between 1 and 50,000 characters.");
  if ((await readDailyNote(args.id, args.date)).exists) return { status: "existing" as const };
  const activity = (await collectDailyNoteActivity({ ...args, from: args.date, to: args.date }))[0];
  if (!activity) return { status: "inactive" as const };
  const directory = path.join(await familiarWorkspace(args.id), "notes");
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
  // Match the existing notes writer: a validated date is one basename.
  const target = path.join(directory, `${path.basename(args.date)}.md`);
  if (path.relative(directory, target).startsWith("..")) throw new Error("Path not allowed.");
  const temporary = path.join(directory, `.daily-note.${randomUUID()}.tmp`);
  try {
    await writeFile(/* turbopackIgnore: true */ temporary, formatDailyNote(args.date, { notes: activity.digest, reflection }), { flag: "wx" });
    await link(/* turbopackIgnore: true */ temporary, target);
    return { status: "generated" as const };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { status: "existing" as const };
    throw error;
  } finally { await rm(/* turbopackIgnore: true */ temporary, { force: true }); }
}
