// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "cave-journal-store-"));
process.env.COVEN_HOME = root;

const store = await import("./journal-store.ts");
const date = "2026-07-26";

try {
  const missing = await store.readJournalEntry(date);
  assert.equal(missing.exists, false, "a missing journal day is a normal empty record");
  assert.deepEqual(await store.listJournalEntries(), [], "a missing journal directory is an empty list");
  assert.equal(await store.deleteJournalEntry(date), false, "deleting a missing journal day is a no-op");

  const journalDir = path.join(root, "journal");
  await mkdir(path.join(journalDir, `${date}.md`), { recursive: true });

  await assert.rejects(
    store.readJournalEntry(date),
    "a non-file journal entry must surface its filesystem error",
  );
  await assert.rejects(
    store.deleteJournalEntry(date),
    "a non-file journal entry must not masquerade as an already-deleted file",
  );

  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "journal"), "not a directory", "utf8");
  await assert.rejects(
    store.listJournalEntries(),
    "a broken journal directory must not masquerade as an empty journal",
  );

  console.log("journal-store.test.ts: ok");
} finally {
  delete process.env.COVEN_HOME;
  await rm(root, { recursive: true, force: true });
}
