import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import {
  RELEASE_BODY_PLACEHOLDER,
  isDirectRun,
  manifestNotes,
  selectSignedArtifact,
} from "./generate-latest-json.mjs";

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

// Exercise the real CLI; only the external gh process is replaced. The stub
// honors requested JSON fields, so forgetting to request body loses the notes.
function runReleaseFixture(t, body, signed = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "notes-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = path.join(dir, "gh-fixture.mjs");
  writeFileSync(preload, `
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { writeFileSync } from "node:fs";
    import { join } from "node:path";
    cp.execFileSync = (command, args) => {
      if (command !== "gh") throw new Error("Unexpected process");
      if (args[1] === "view") {
        const release = ${JSON.stringify({assets:[{name:"Cave.AppImage"}],body})};
        return JSON.stringify(Object.fromEntries(args[args.indexOf("--json") + 1]
          .split(",").map(key => [key, release[key]])));
      }
      if (args[1] === "download") {
        if (${signed}) writeFileSync(join(args[args.indexOf("--dir") + 1], "Cave.AppImage.sig"), "fixture-signature");
        return "";
      }
      throw new Error("Unexpected gh operation");
    };
    syncBuiltinESMExports();
  `);
  return spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, SCRIPT, "v9.9.9"], {
    cwd: ROOT, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir },
  });
}

test("manifest CLI preserves multiline release notes with signed artifact metadata", t => {
  const result = runReleaseFixture(t, "## Changes\n\nRésumé — fixed <widget>.");
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.notes, "## Changes\n\nRésumé — fixed <widget>.");
  assert.equal(manifest.version, "9.9.9");
  assert.equal(manifest.platforms["linux-x86_64"].signature, "fixture-signature");
});

for (const body of [undefined, null, "", "   ", { unexpected: true }]) {
  test(`manifest accepts absent or unusable notes: ${JSON.stringify(body)}`, t => {
    const result = runReleaseFixture(t, body);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).notes, undefined);
  });
}

test("notes cannot make an unsigned release an updater manifest", t => {
  const result = runReleaseFixture(t, "Notes exist", false);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
});

// #5981: v0.5.18, v0.5.21 and v0.5.22 shipped this placeholder as their
// latest.json notes, because updater-manifest read the release body before
// checksums replaced it. Updating clients showed it as the release notes.
test("the release-object placeholder body is never published as release notes", t => {
  for (const body of [RELEASE_BODY_PLACEHOLDER, `  ${RELEASE_BODY_PLACEHOLDER}\n`]) {
    assert.equal(manifestNotes(body), undefined);
    const result = runReleaseFixture(t, body);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).notes, undefined);
    assert.match(result.stderr, /still the placeholder/);
  }
  assert.equal(manifestNotes(`${RELEASE_BODY_PLACEHOLDER} Then the real notes.`), `${RELEASE_BODY_PLACEHOLDER} Then the real notes.`);
});

test("the manifest waits for the jobs that render release notes, with bounded waits", () => {
  const workflowSource = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  const { jobs } = parse(workflowSource);
  const createStep = jobs["release-object"].steps.map(step => step.run ?? "").join("\n");
  assert.ok(
    createStep.includes(`--notes "${RELEASE_BODY_PLACEHOLDER}"`),
    "release-object must create the release with exactly the placeholder the generator drops",
  );
  const manifest = jobs["updater-manifest"];
  for (const job of ["checksums", "partial-release-notes"]) {
    assert.ok(manifest.needs.includes(job), `updater-manifest must wait for ${job}, which sets the release notes`);
    const minutes = jobs[job]["timeout-minutes"];
    assert.ok(Number.isInteger(minutes) && minutes <= 20, `${job} must be bounded: latest.json waits on it`);
  }
  for (const job of ["build", "source-version", "rollback-readiness"]) {
    assert.ok(manifest.needs.includes(job), `updater-manifest still needs ${job}`);
  }
  assert.match(manifest.if, /^\$\{\{ !cancelled\(\)/, "a failed or skipped notes job must not withhold latest.json");
  assert.match(manifest.if, /needs\.rollback-readiness\.result == 'success'/, "the rollback gate stays explicit");
  assert.doesNotMatch(manifest.if, /needs\.checksums\.result/, "notes are best effort; checksums must not gate the manifest");
  assert.match(
    jobs.checksums.steps.find(step => step.name === "Set release notes").run,
    /gh release edit "\$RELEASE_TAG" --notes-file/,
    "checksums replaces the placeholder body",
  );
});
