import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { retainedJournalDefinition } from "./journal-command-intent.ts";
import type { CovenantAutomationDraft } from "../coven-automations-types.ts";

const definition = (prompt: string) => ({ id: "journal-astra", prompt } as CovenantAutomationDraft);

test("concurrent preparation adopts one complete payload and later reads do not prepare again", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-intent-"));
  try {
    const results = await Promise.all(["first", "second"].map(prompt => retainedJournalDefinition(root, "same-key", { hour: 8 }, async () => definition(prompt))));
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(await retainedJournalDefinition(root, "same-key", { hour: 8 }, async () => { throw new Error("must not prepare"); }), results[0]);
    await assert.rejects(retainedJournalDefinition(root, "same-key", { hour: 9 }, async () => definition("changed")), { uncertain: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("corrupt, oversized and linked records remain untouched and refuse dispatch preparation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-intent-"));
  try {
    await retainedJournalDefinition(root, "same-key", {}, async () => definition("original"));
    const file = path.join(root, ".cave-command-intents", `${createHash("sha256").update("same-key").digest("hex")}.json`);
    for (const bytes of ["broken", "x".repeat(1024 * 1024 + 1)]) {
      await writeFile(file, bytes);
      await assert.rejects(retainedJournalDefinition(root, "same-key", {}, async () => { throw new Error("must not prepare"); }), { uncertain: true });
      assert.equal(await readFile(file, "utf8"), bytes);
    }
    await rm(file);
    const target = path.join(root, "target");
    await writeFile(target, "private");
    await symlink(target, file);
    await assert.rejects(retainedJournalDefinition(root, "same-key", {}, async () => definition("changed")), { uncertain: true });
    assert.equal(await readFile(target, "utf8"), "private");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a replaced FIFO intent record is refused without blocking the request", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journal-intent-"));
  try {
    await retainedJournalDefinition(root, "same-key", {}, async () => definition("original"));
    const file = path.join(root, ".cave-command-intents", `${createHash("sha256").update("same-key").digest("hex")}.json`);
    await rm(file);
    assert.equal(spawnSync("mkfifo", [file]).status, 0);
    const code = `import { retainedJournalDefinition } from ${JSON.stringify(new URL("./journal-command-intent.ts", import.meta.url).href)};
await retainedJournalDefinition(${JSON.stringify(root)}, "same-key", {}, async () => { throw new Error("must not prepare"); }).then(() => process.exit(2), error => { if (error.uncertain !== true) throw error; });`;
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", code], { timeout: 2000, encoding: "utf8" });
    assert.equal(child.error, undefined, "intent reads must not wait for a FIFO writer");
    assert.equal(child.status, 0, child.stderr);
  } finally { await rm(root, { recursive: true, force: true }); }
});
