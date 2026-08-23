import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isDirectRun, selectSignedArtifact } from "./generate-latest-json.mjs";

const SCRIPT = fileURLToPath(new URL("./generate-latest-json.mjs", import.meta.url));
const ROOT = path.dirname(path.dirname(SCRIPT));

// Run with no arguments so the script stops at its own usage check and never
// shells out to `gh` — this asserts the entry point EXECUTES, not what it does.
const runCli = (scriptPath, cwd = ROOT) =>
  spawnSync(process.execPath, [scriptPath], { cwd, encoding: "utf8", timeout: 60_000 });

test("signed artifact selection chooses the first signed match", () => {
  const assets = [
    "CovenCave_0.0.140_amd64.AppImage",
    "CovenCave_0.0.140_amd64.AppImage.sig",
  ];
  const sigs = new Set(assets.filter((name) => name.endsWith(".sig")));

  assert.equal(
    selectSignedArtifact(
      assets,
      (name) => name.endsWith(".AppImage"),
      (name) => sigs.has(`${name}.sig`),
    ),
    "CovenCave_0.0.140_amd64.AppImage",
  );
});

// ── the CLI actually runs ──────────────────────────────────────────────
// Until cave-gcb0i the main-guard here was
// `import.meta.url === new URL(process.argv[1], "file:").href`, which is false
// on Windows: `node scripts/generate-latest-json.mjs` printed nothing and
// exited 0 instead of reporting its usage error. A generator that exits 0
// without generating is indistinguishable from a successful run, and the
// release step redirects its stdout straight into latest.json.
test("the CLI executes and reports usage when invoked with no tag", () => {
  const result = runCli(SCRIPT);
  assert.equal(result.status, 1, "a missing tag must be an error, not a silent exit 0");
  assert.match(result.stderr, /usage: generate-latest-json\.mjs <tag>/);
});

test("the CLI executes when invoked by a relative path", () => {
  // How release.yml calls it: `node scripts/generate-latest-json.mjs "$TAG"`.
  const result = runCli(path.join("scripts", "generate-latest-json.mjs"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: generate-latest-json\.mjs <tag>/);
});

test("the CLI executes when reached through a symlink", (t) => {
  // Node realpaths the main module's URL but leaves argv[1] as the link path,
  // so a naive string comparison of the two silently skips main().
  const dir = mkdtempSync(path.join(tmpdir(), "genlatest-link-"));
  const link = path.join(dir, "linked-generate-latest-json.mjs");
  try {
    symlinkSync(SCRIPT, link, "file");
  } catch {
    t.skip("this platform does not allow creating symlinks unprivileged");
    return;
  }
  const result = runCli(link);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: generate-latest-json\.mjs <tag>/);
});

test("isDirectRun matches only the module that is actually being executed", () => {
  assert.equal(isDirectRun(SCRIPT, new URL("./generate-latest-json.mjs", import.meta.url).href), true);
  assert.equal(isDirectRun(SCRIPT, new URL("./verify-release-updater.mjs", import.meta.url).href), false);
  assert.equal(isDirectRun("", import.meta.url), false);
  assert.equal(isDirectRun(undefined, import.meta.url), false);
  assert.equal(isDirectRun(SCRIPT, "not-a-url"), false);
});

test("the retired URL idiom does not match a Windows-shaped argv[1]", () => {
  // Pinned as a regression note: this is exactly the comparison that made the
  // guard above silently false, and it is platform-independent to assert.
  const windowsArgv1 = "C:\\repo\\scripts\\generate-latest-json.mjs";
  assert.notEqual(new URL(windowsArgv1, "file:").href, "file:///C:/repo/scripts/generate-latest-json.mjs");
});

test("signed artifact selection skips unsigned matches", () => {
  const assets = [
    "CovenCave_0.0.140_unsigned.AppImage",
    "CovenCave_0.0.140_amd64.AppImage",
    "CovenCave_0.0.140_amd64.AppImage.sig",
  ];
  const sigs = new Set(assets.filter((name) => name.endsWith(".sig")));

  assert.equal(
    selectSignedArtifact(
      assets,
      (name) => name.endsWith(".AppImage"),
      (name) => sigs.has(`${name}.sig`),
    ),
    "CovenCave_0.0.140_amd64.AppImage",
  );
});
