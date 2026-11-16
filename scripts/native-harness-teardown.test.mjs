// The runtime activity harnesses' teardown must never turn a passing suite
// into an uncaught crash (#6340). These cases pin the helper's contract with
// injected fs functions, one real-filesystem removal, and a source guard that
// every harness routes its root removal through the helper.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { LATE_WRITE_LISTING_LIMIT, lateWriteRecord, removeFixtureRoot } from "./native-harness-teardown.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const HARNESSES = [
  "runtime-activity-native-transport.mjs",
  "runtime-activity-effect-recovery.mjs",
  "runtime-activity-client-fixture.mjs",
  "runtime-activity-browser-fixture.mjs",
];

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

test("a persistent late write names what is under the directory rm could not empty, recursively", async () => {
  const offending = "/synthetic/root/coven/cave";
  let listed = null;
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw fsError("ENOTEMPTY", offending); },
    readdir: async (target, options) => {
      listed = { target, options };
      return ["sessions", "sessions/abc/turns.jsonl", "cave.log"];
    },
  });
  assert.deepEqual(listed, { target: offending, options: { recursive: true } },
    "the listing targets the directory rm could not empty and descends into it");
  assert.equal(result.removed, false);
  assert.equal(result.code, "ENOTEMPTY");
  assert.equal(result.path, offending);
  assert.match(result.message, /ENOTEMPTY/, "the error text, which carries the rmdir path, is kept");
  assert.deepEqual(result.entries, ["cave.log", "sessions", "sessions/abc/turns.jsonl"], "relative paths, sorted");
  assert.equal(result.truncated, false);
  assert.deepEqual(lateWriteRecord(result), {
    code: "ENOTEMPTY", path: offending, message: result.message,
    entries: ["cave.log", "sessions", "sessions/abc/turns.jsonl"], truncated: false,
  });
});

test("a transient writer reads as an empty listing, distinct from an unlistable one", async () => {
  const transient = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw fsError("ENOTEMPTY", "/synthetic/root/coven/cave"); },
    readdir: async () => [],
  });
  assert.deepEqual(transient.entries, []);
  const unlistable = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw fsError("EPERM", "/synthetic/root/coven"); },
    readdir: async () => { throw fsError("ENOENT", "/synthetic/root/coven"); },
  });
  assert.equal(unlistable.removed, false);
  assert.equal(unlistable.code, "EPERM");
  assert.equal(unlistable.entries, null);
});

test("a runaway writer's listing is capped and marked truncated", async () => {
  const many = Array.from({ length: LATE_WRITE_LISTING_LIMIT + 25 }, (_, index) => `f${String(index).padStart(3, "0")}`);
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw fsError("ENOTEMPTY", "/synthetic/root/coven/cave"); },
    readdir: async () => many,
  });
  assert.equal(result.entries.length, LATE_WRITE_LISTING_LIMIT);
  assert.equal(result.truncated, true);
  assert.equal(result.entries[0], "f000");
});

test("an error without a path or code falls back to the root and UNKNOWN", async () => {
  const result = await removeFixtureRoot("/synthetic/root", {
    rm: async () => { throw new Error("no fields"); },
    readdir: async () => [],
  });
  assert.equal(result.removed, false);
  assert.equal(result.path, "/synthetic/root");
  assert.equal(result.code, "UNKNOWN");
  assert.equal(result.message, "no fields");
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

test("a real directory is listed recursively when removal is refused", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-native-teardown-list-"));
  try {
    await mkdir(path.join(root, "coven", "cave", "sessions"), { recursive: true });
    await writeFile(path.join(root, "coven", "cave", "sessions", "turns.jsonl"), "{}\n");
    const result = await removeFixtureRoot(root, {
      rm: async () => { throw fsError("ENOTEMPTY", path.join(root, "coven", "cave")); },
    });
    assert.deepEqual(result.entries, ["sessions", path.join("sessions", "turns.jsonl")]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every runtime activity harness routes its root removal through the helper", async () => {
  for (const name of HARNESSES) {
    const source = await readFile(path.join(here, name), "utf8");
    assert.match(source, /import \{[^}]*\bremoveFixtureRoot\b[^}]*\} from ["']\.\/native-harness-teardown\.mjs["'];/, `${name} imports the helper`);
    assert.match(source, /await removeFixtureRoot\(root\b/, `${name} removes its root through the helper`);
    assert.doesNotMatch(source, /\brm\(\s*root\b/, `${name} no longer calls rm on its root directly`);
    assert.match(source, /teardownLateWrite/, `${name} records a persistent late write in result.json`);
  }
});
