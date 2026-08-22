// Proves the shared direct-run guard by EXECUTING scripts, never by matching
// their source text.
//
// A source-text pin cannot tell a working CLI entry from a broken one — that is
// exactly how cave-zya survived: `check-conflict-markers.mjs` and
// `generate-icon-subset.mjs` both carried a spelling that reads correctly and
// was unconditionally inert on Windows, so a repo-wide gate exited 0 on a tree
// full of conflict markers and the icon subset was never regenerated during a
// Windows build. Only running them catches that.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isDirectRun } from "./direct-run.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("an imported module is not a direct run", () => {
  // direct-run.mjs is imported by this file, never the process entry point, so
  // the helper must say no for it. Deliberately NOT asserted against
  // `import.meta.url`: under `node --test` this file IS argv[1], so that would
  // pin the runner's invocation shape rather than the helper's semantics.
  const imported = new URL("./direct-run.mjs", import.meta.url).href;
  assert.equal(isDirectRun(imported), false);
});

test("a module that does not exist on disk is not a direct run", () => {
  // realpathSync throws for a missing path; the helper must fail closed rather
  // than propagate, so an importing test can never execute a CLI body.
  const missing = new URL("./direct-run.does-not-exist.mjs", import.meta.url).href;
  assert.equal(isDirectRun(missing), false);
});

test("a missing argv[1] is not a direct run", () => {
  const original = process.argv[1];
  try {
    // Node can be invoked with no script path (`node --eval`), and the helper
    // must fail closed rather than throw.
    process.argv[1] = undefined;
    assert.equal(isDirectRun(import.meta.url), false);
  } finally {
    process.argv[1] = original;
  }
});

test("a script run directly reports a direct run, even from a path with a space", () => {
  const dir = tempDir("direct run guard ");
  try {
    const script = join(dir, "entry.mjs");
    // Import the helper by absolute file URL so the fixture needs no
    // node_modules resolution of its own.
    const helper = JSON.stringify(new URL("./direct-run.mjs", import.meta.url).href);
    writeFileSync(
      script,
      `import { isDirectRun } from ${helper};\n` +
        `process.stdout.write(isDirectRun(import.meta.url) ? "DIRECT" : "IMPORTED");\n`,
      "utf8",
    );

    const run = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "DIRECT", "a directly executed script must report DIRECT");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-conflict-markers actually runs as a CLI and fails a dirty tree", () => {
  // The cave-zya regression itself. Before the fix this exited 0 and printed
  // nothing on Windows, because main() never ran.
  const script = join(scriptsDir, "check-conflict-markers.mjs");

  const makeRepo = (contents) => {
    const dir = tempDir("conflict markers ");
    const git = (...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    writeFileSync(join(dir, "a.ts"), contents, "utf8");
    git("add", "-A");
    git("commit", "-qm", "fixture");
    return dir;
  };

  const clean = makeRepo("const a = 1;\n");
  const dirty = makeRepo("<<<<<<< HEAD\n");
  try {
    const ok = spawnSync(process.execPath, [script], { cwd: clean, encoding: "utf8" });
    assert.equal(ok.status, 0, `a clean tree must exit 0\n${ok.stderr}`);
    assert.match(ok.stdout, /no committed conflict markers/, "and say so on stdout");

    const bad = spawnSync(process.execPath, [script], { cwd: dirty, encoding: "utf8" });
    assert.equal(bad.status, 1, "a gate that cannot fail is not a gate");
    assert.match(bad.stderr, /merge-conflict markers/i);
  } finally {
    rmSync(clean, { recursive: true, force: true });
    rmSync(dirty, { recursive: true, force: true });
  }
});

test("generate-icon-subset actually runs as a CLI and regenerates identical output", async () => {
  // The second instance of the same defect, and the one with teeth: this script
  // runs in `prebuild`, so a dead guard means a Windows build silently ships
  // whatever subset happened to be committed.
  //
  // Its outputs resolve against `import.meta.url`, not the cwd, so a copy of the
  // script would still write into this checkout. Snapshot the three committed
  // files, run it for real, then restore them no matter what. Regeneration is
  // idempotent by construction (every build does it), so asserting the bytes are
  // unchanged both proves main() ran and pins that invariant.
  const { SUBSET_URL, GLYPH_URL, FAMILIAR_CORE_URL } = await import("./generate-icon-subset.mjs");
  const outputs = [SUBSET_URL, GLYPH_URL, FAMILIAR_CORE_URL].map((url) => fileURLToPath(url));
  const before = outputs.map((file) => readFileSync(file));

  try {
    const run = spawnSync(
      process.execPath,
      [join(scriptsDir, "generate-icon-subset.mjs")],
      { encoding: "utf8" },
    );

    // A guard that never fires produces no output on either stream and exits 0 —
    // indistinguishable from success unless you look for the output itself.
    assert.notEqual(
      `${run.stdout}${run.stderr}`.trim(),
      "",
      "the CLI produced no output at all, which is exactly what a dead direct-run guard looks like",
    );
    assert.equal(run.status, 0, `generate-icon-subset should succeed\n${run.stderr}`);

    outputs.forEach((file, index) => {
      assert.ok(
        readFileSync(file).equals(before[index]),
        `${file} changed — the committed icon subset is stale, rerun pnpm prebuild`,
      );
    });
  } finally {
    outputs.forEach((file, index) => writeFileSync(file, before[index]));
  }
});
