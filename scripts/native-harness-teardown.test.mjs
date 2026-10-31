// The native transport harness's teardown must never turn a passing suite
// into an uncaught crash (#6340). These cases pin the helper's contract with
// injected fs functions, one real-filesystem removal, and a source guard that
// the harness actually routes its root removal through the helper.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { removeFixtureRoot } from "./native-harness-teardown.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function fsError(code, target) {
  const error = new Error(`${code}: synthetic, rmdir '${target}'`);
  error.code = code;
  error.syscall = "rmdir";
  error.path = target;
  return error;
}

test("a clean removal reports removed and asks rm for its own retry budget", async () => {
  const calls = [];
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async (target, options) => { calls.push({ target, options }); },
    readdir: async () => { throw new Error("readdir must not run on success"); },
  });
  assert.deepEqual(result, { removed: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, "/synthetic/root");
  assert.deepEqual(calls[0].options, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("a persistent late write preserves the root and names what was written instead of throwing", async () => {
  const offending = "/synthetic/root/coven/cave";
  let listed = null;
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw fsError("ENOTEMPTY", offending); },
    readdir: async (target) => { listed = target; return ["sessions", "cave.log"]; },
  });
  assert.equal(listed, offending, "the listing targets the directory rm could not empty");
  assert.equal(result.removed, false);
  assert.equal(result.preservedRoot, "/synthetic/root");
  assert.equal(result.code, "ENOTEMPTY");
  assert.equal(result.path, offending);
  assert.deepEqual(result.entries, ["cave.log", "sessions"], "names only, sorted");
  assert.match(result.message, /ENOTEMPTY/);
});

test("a listing failure still returns a preserved-root record", async () => {
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw fsError("EPERM", "/synthetic/root/coven"); },
    readdir: async () => { throw fsError("ENOENT", "/synthetic/root/coven"); },
  });
  assert.equal(result.removed, false);
  assert.equal(result.code, "EPERM");
  assert.equal(result.entries, null);
});

test("an error without a path or code falls back to the root and UNKNOWN", async () => {
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw new Error("no fields"); },
    readdir: async () => [],
  });
  assert.equal(result.removed, false);
  assert.equal(result.path, "/synthetic/root");
  assert.equal(result.code, "UNKNOWN");
  assert.deepEqual(result.entries, []);
});

test("the helper refuses an empty root rather than removing nothing silently", async () => {
  await assert.rejects(() => removeFixtureRoot(""), TypeError);
  await assert.rejects(() => removeFixtureRoot(undefined), TypeError);
});

test("a real nested fixture root is removed with the default fs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-native-teardown-test-"));
  try {
    const cave = path.join(root, "coven", "cave");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(cave, "late.log"), "late write\n");
    const result = await removeFixtureRoot(root, { retryDelay: 1 });
    assert.deepEqual(result, { removed: true });
    await assert.rejects(() => stat(root), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the native transport harness routes its root removal through the helper", async () => {
  const source = await readFile(path.join(here, "runtime-activity-native-transport.mjs"), "utf8");
  assert.match(source, /import \{ removeFixtureRoot \} from '\.\/native-harness-teardown\.mjs';/);
  assert.match(source, /const removal = await removeFixtureRoot\(root\);/);
  assert.doesNotMatch(source, /await rm\(root,/, "the bare recursive rm that threw out of finally is gone");
  assert.match(source, /runReport\.teardownLateWrite = /, "a persistent late write is recorded in result.json");
});
