// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = await mkdtemp(path.join(os.tmpdir(), "cave-daily-notes-"));
process.env.COVEN_HOME = root;
process.env.COVEN_CAVE_HOME = path.join(root, "cave");
process.env.COVEN_WORKSPACES_ROOT = path.join(root, "workspaces");
const { collectDailyNoteActivity, validateNoteRange, saveGeneratedDailyNote } = await import("./familiar-note-generation.ts");
const { readDailyNote, writeDailyNote } = await import("./familiar-notes.ts");
const now = new Date(2026, 9, 11, 12);
const stamp = (day) => new Date(2026, 9, day, 12).toISOString();
const turns = [2, 4].map((day) => ({ role: "assistant", text: `Worked on day ${day}`, createdAt: stamp(day) }));
const conversations = [
  { sessionId: "own", familiarId: "sage", title: "Real work", turns },
  { sessionId: "foreign", familiarId: "nova", title: "Other familiar", turns },
  { sessionId: "generated", familiarId: "sage", origin: "journal", turns: [{ role: "assistant", text: "Reflection only", createdAt: stamp(3) }] },
];
const dependencies = {
  list: async () => conversations,
  load: async (id) => conversations.find((c) => c.sessionId === id),
};
try {
  assert.throws(() => validateNoteRange("2026-02-30", "2026-10-11", now));
  assert.throws(() => validateNoteRange("2026-10-12", "2026-10-12", now));
  assert.throws(() => validateNoteRange("2026-10-05", "2026-10-01", now));
  assert.throws(() => validateNoteRange("2026-01-01", "2026-10-11", now));
  const memory = path.join(root, "workspaces/familiars/sage/memory/fact.md");
  await mkdir(path.dirname(memory), { recursive: true });
  await writeFile(memory, "# A lesson\nCheck the evidence.");
  await utimes(memory, new Date(stamp(5)), new Date(stamp(5)));
  const args = { id: "sage", from: "2026-10-01", to: "2026-10-06", now, dependencies };
  const days = await collectDailyNoteActivity(args);
  assert.deepEqual(days.map((d) => d.date), ["2026-10-02", "2026-10-04", "2026-10-05"], "actual turn days, not latest session update or generation runs");
  assert.match(days[0].context, /Worked on day 2/);
  assert.doesNotMatch(days[0].context, /Worked on day 4|Other familiar/);
  assert.match(days[2].digest, /fact.md/);
  for (const date of ["../2026-10-02", "2026-10-02/../other", "2026-10-02\\other", "2026-10-02%2fother"]) {
    await assert.rejects(() => saveGeneratedDailyNote({ ...args, date, reflection: "Invalid path" }), /Choose up to 31 days/);
  }
  assert.equal((await saveGeneratedDailyNote({ ...args, date: "2026-10-03", reflection: "Invented" })).status, "inactive");
  assert.equal((await readDailyNote("sage", "2026-10-03")).exists, false);
  const results = await Promise.all(["First", "Second"].map((reflection) => saveGeneratedDailyNote({ ...args, date: "2026-10-02", reflection })));
  assert.deepEqual(results.map((r) => r.status).sort(), ["existing", "generated"], "concurrent generation never replaces a winner");
  await writeDailyNote("sage", "2026-10-04", { notes: "My writing", reflection: "My reflection" });
  assert.equal((await saveGeneratedDailyNote({ ...args, date: "2026-10-04", reflection: "Replacement" })).status, "existing");
  assert.equal((await readDailyNote("sage", "2026-10-04")).note.reflection, "My reflection");
  assert.equal((await collectDailyNoteActivity(args)).find((d) => d.date === "2026-10-04").exists, true);
  await assert.rejects(() => saveGeneratedDailyNote({ ...args, date: "2026-10-05", reflection: "  " }));
  await assert.rejects(() => collectDailyNoteActivity({ ...args, id: "../sage" }));
  await assert.rejects(() => collectDailyNoteActivity({ ...args, dependencies: { ...dependencies, load: async () => null } }), /activity/);
  assert.match(await readFile(path.join(root, "workspaces/familiars/sage/notes/2026-10-02.md"), "utf8"), /Real work/);
  console.log("familiar-note-generation: all assertions passed");
} finally { await rm(root, { recursive: true, force: true }); }
