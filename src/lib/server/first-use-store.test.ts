import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFirstUseState, updateFirstUseState } from "./first-use-store.ts";

test("progress survives reread while stale and concurrent updates cannot overwrite it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-first-use-"));
  const file = path.join(root, "first-use.json");
  try {
    assert.equal((await readFirstUseState(file)).step, "outcome");
    const state = await updateFirstUseState(0, { kind: "outcome", outcome: "inspect" }, file);
    assert.equal(state.revision, 1);
    assert.deepEqual(await readFirstUseState(file), state);
    await assert.rejects(updateFirstUseState(0, { kind: "outcome", outcome: "plan" }, file), /changed/i);
    const defaults = { projectId: "a", familiarIds: ["nova"], actingFamiliarId: "nova" };
    const writes = await Promise.allSettled([
      updateFirstUseState(1, { kind: "context", defaults }, file),
      updateFirstUseState(1, { kind: "context", defaults: { ...defaults, projectId: "b" } }, file),
    ]);
    assert.equal(writes.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal((await readFirstUseState(file)).revision, 2);
    assert.equal((await readFirstUseState(file)).defaults?.projectId, "a");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("malformed and unreadable saved state is retained rather than silently reinitialized", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-first-use-corrupt-"));
  const file = path.join(root, "first-use.json");
  try {
    await writeFile(file, "{broken");
    await assert.rejects(readFirstUseState(file));
    await assert.rejects(updateFirstUseState(0, { kind: "outcome", outcome: "plan" }, file));
    assert.equal(await readFile(file, "utf8"), "{broken");
    await assert.rejects(readFirstUseState(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("two host processes cannot both commit the same introduction revision", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-first-use-process-"));
  const file = path.join(root, "first-use.json");
  try {
    await updateFirstUseState(0, { kind: "outcome", outcome: "plan" }, file);
    const children = Array.from({ length: 6 }, (_, index) => {
      const script = `import { updateFirstUseState } from ${JSON.stringify(new URL("./first-use-store.ts", import.meta.url).href)};
process.stdout.write("ready\\n");
await new Promise(resolve => process.stdin.once("data", resolve));
try { await updateFirstUseState(1, { kind: "context", defaults: { projectId: "p${index}", familiarIds: ["nova"], actingFamiliarId: "nova" } }, ${JSON.stringify(file)}); process.exitCode = 0; }
catch (error) { if (!error.message.includes("changed")) throw error; process.exitCode = 2; }`;
      const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
      const ready = once(child.stdout, "data");
      const finished = once(child, "exit");
      return { child, ready, finished };
    });
    await Promise.all(children.map((entry) => entry.ready));
    for (const entry of children) entry.child.stdin.end("go");
    const codes = await Promise.all(children.map(async (entry) => (await entry.finished)[0]));
    assert.equal(codes.filter((code) => code === 0).length, 1, `only one process may save revision 1: ${codes}`);
    assert.equal(codes.filter((code) => code === 2).length, 5);
    assert.equal((await readFirstUseState(file)).revision, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
