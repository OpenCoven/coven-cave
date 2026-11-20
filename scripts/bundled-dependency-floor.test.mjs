import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BUNDLED_DEPENDENCY_FLOORS,
  checkBundledDependencyFloor,
  collectBundledDependencyFloorProblems,
  collectPinnedFloorProblems,
  compareFinalVersions,
  parseFinalVersion,
} from "./bundled-dependency-floor.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "bundled-dependency-floor.mjs");

// Each value is a version string, a manifest object, or `{ raw }` text written
// verbatim to package.json.
async function runtimeFixture(packages) {
  const root = await mkdtemp(path.join(os.tmpdir(), "coven-bundled-floor-"));
  for (const [name, manifest] of Object.entries(packages)) {
    const packageRoot = path.join(root, "node_modules", ...name.split("/"));
    await mkdir(packageRoot, { recursive: true });
    let text;
    if (typeof manifest === "string") text = JSON.stringify({ name, version: manifest });
    else if ("raw" in manifest) text = manifest.raw;
    else text = JSON.stringify(manifest);
    await writeFile(path.join(packageRoot, "package.json"), `${text}\n`, "utf8");
  }
  return root;
}

async function withRuntime(versions, body) {
  const root = await runtimeFixture(versions);
  try {
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the floors are the patched minimums recorded on #5339 and #6264", () => {
  assert.deepEqual(
    BUNDLED_DEPENDENCY_FLOORS.map(({ name, minimum }) => [name, minimum]),
    [
      ["next", "16.4.1"],
      ["sharp", "0.35.4"],
    ],
    "lowering a floor reopens #5339; raising one is a reviewed security decision",
  );
  assert.ok(Object.isFrozen(BUNDLED_DEPENDENCY_FLOORS));
  for (const floor of BUNDLED_DEPENDENCY_FLOORS) {
    assert.ok(Object.isFrozen(floor), `${floor.name} floor must be immutable`);
    assert.ok(parseFinalVersion(floor.minimum), `${floor.name} floor must be a final version`);
    assert.match(floor.reason, /, #\d+$/, `${floor.name} floor must cite its incident`);
  }
});

test("the repository's own pins clear the floor, so main never builds a bundle the guard refuses", async () => {
  const manifest = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  const pins = [
    ["next", manifest.dependencies?.next],
    ["sharp", manifest.dependencies?.sharp],
    ["sharp", manifest.pnpm?.overrides?.sharp],
  ];
  for (const [name, pin] of pins) {
    const floor = BUNDLED_DEPENDENCY_FLOORS.find((entry) => entry.name === name);
    const pinned = parseFinalVersion(pin);
    assert.ok(pinned, `${name} must stay pinned to an exact final version, found ${JSON.stringify(pin)}`);
    assert.ok(
      compareFinalVersions(pinned, parseFinalVersion(floor.minimum)) >= 0,
      `${name} pin ${pin} is below the #5339 floor ${floor.minimum}`,
    );
  }
});

test("a release's package.json pins are checked against the floor (#6076)", async () => {
  // The rollback gate reads an already-published baseline's pins rather than
  // its bundled bytes. The repository's own package.json is the shape every
  // patched tag has, and it must read clean through the same function.
  const own = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  const clean = collectPinnedFloorProblems(own);
  assert.deepEqual(clean.problems, []);
  assert.deepEqual(Object.keys(clean.versions), ["next", "sharp"]);

  const pinned = (next, sharp, override = sharp) => ({
    dependencies: { next, sharp },
    pnpm: { overrides: { sharp: override } },
  });

  // v0.4.1's real pins: every floored field is named, the override included.
  const v041 = collectPinnedFloorProblems(pinned("16.3.1", "0.35.3"));
  assert.deepEqual(v041.versions, { next: "16.3.1", sharp: "0.35.3" });
  assert.deepEqual(
    v041.problems.map((problem) => problem.split(" is ")[0]),
    ["dependencies.next 16.3.1", "dependencies.sharp 0.35.3", "pnpm.overrides.sharp 0.35.3"],
  );
  assert.match(v041.problems[0], /below the patched minimum 16\.4\.1 \(GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r, #6264\)$/);

  // At the floor is clear; one patch below it is not.
  assert.deepEqual(collectPinnedFloorProblems(pinned("16.4.1", "0.35.4")).problems, []);
  assert.equal(collectPinnedFloorProblems(pinned("16.4.0", "0.35.4")).problems.length, 1);
  // v0.5.17 pinned Next 16.3.8, which #6264 put below the floor.
  assert.match(collectPinnedFloorProblems(pinned("16.3.8", "0.35.5")).problems[0], /^dependencies\.next 16\.3\.8 is below the patched minimum 16\.4\.1/);

  // The override is what pnpm installs, so it is checked on its own.
  const override = collectPinnedFloorProblems(pinned("16.4.3", "0.35.5", "0.35.3"));
  assert.deepEqual(override.problems.length, 1);
  assert.match(override.problems[0], /^pnpm\.overrides\.sharp 0\.35\.3 is below/);
  // No override at all is fine: the dependency pin is then what installs.
  assert.deepEqual(collectPinnedFloorProblems({ dependencies: { next: "16.4.3", sharp: "0.35.5" } }).problems, []);
});

test("a pin the floor cannot compare fails closed", () => {
  const problemsFor = (manifest) => collectPinnedFloorProblems(manifest).problems;
  assert.match(problemsFor({ dependencies: { sharp: "0.35.5" } })[0], /^package\.json pins no next in dependencies; the floor is 16\.4\.1/);
  for (const pin of ["^16.3.3", "~16.3.8", "16.3.8-canary.1", "latest", "workspace:*", "", 16.3, null]) {
    const problems = problemsFor({ dependencies: { next: pin, sharp: "0.35.5" } });
    assert.equal(problems.length, 1, `${JSON.stringify(pin)} must not pass`);
    assert.match(problems[0], /^dependencies\.next .* is not a final MAJOR\.MINOR\.PATCH version/);
  }
  // Inherited properties are not pins.
  assert.match(
    problemsFor({ dependencies: Object.create({ next: "16.3.8", sharp: "0.35.5" }) })[0],
    /pins no next in dependencies/,
  );
  for (const manifest of [null, [], "16.3.8", 7]) {
    assert.deepEqual(problemsFor(manifest), ["package.json is not a JSON object"]);
  }
  assert.throws(
    () => collectPinnedFloorProblems({ dependencies: { next: "16.3.8" } }, [{ name: "next", minimum: "16.3", reason: "x" }]),
    /floor for next is not a final version/,
  );
});

test("only final MAJOR.MINOR.PATCH releases parse", () => {
  assert.deepEqual(parseFinalVersion("16.3.3"), { major: 16, minor: 3, patch: 3 });
  assert.deepEqual(parseFinalVersion("0.35.4"), { major: 0, minor: 35, patch: 4 });
  for (const rejected of [
    "16.3.3-canary.1",
    "16.4.0-rc.0",
    "16.3.3+build.7",
    "v16.3.3",
    "^16.3.3",
    "16.3",
    "16.03.3",
    " 16.3.3",
    "",
    undefined,
    null,
    16.3,
  ]) {
    assert.equal(parseFinalVersion(rejected), null, `${JSON.stringify(rejected)} must not parse`);
  }
});

test("versions order numerically, not lexically", () => {
  const order = (left, right) => compareFinalVersions(parseFinalVersion(left), parseFinalVersion(right));
  assert.ok(order("16.10.0", "16.9.9") > 0);
  assert.ok(order("16.3.10", "16.3.3") > 0);
  assert.ok(order("17.0.0", "16.99.99") > 0);
  assert.ok(order("16.3.1", "16.3.3") < 0);
  assert.equal(order("16.3.3", "16.3.3"), 0);
});

test("a bundle at or above every floor passes and reports what it read", async () => {
  await withRuntime({ next: "16.4.1", sharp: "0.35.4" }, async (root) => {
    assert.deepEqual(await checkBundledDependencyFloor(root), { next: "16.4.1", sharp: "0.35.4" });
  });
  await withRuntime({ next: "16.4.3", sharp: "0.35.5" }, async (root) => {
    assert.deepEqual(await checkBundledDependencyFloor(root), { next: "16.4.3", sharp: "0.35.5" });
  });
});

test("a pre-patch Next fails with the floor and the advisory named", async () => {
  await withRuntime({ next: "16.3.8", sharp: "0.35.4" }, async (root) => {
    await assert.rejects(
      checkBundledDependencyFloor(root),
      /bundled next 16\.3\.8 is below the patched minimum 16\.4\.1 \(GHSA-2464-fhr4-w9xw/,
    );
  });
});

test("a pre-patch sharp fails even when Next is patched", async () => {
  await withRuntime({ next: "16.4.3", sharp: "0.35.3" }, async (root) => {
    await assert.rejects(checkBundledDependencyFloor(root), /bundled sharp 0\.35\.3 is below the patched minimum 0\.35\.4/);
  });
});

test("every unreadable or unverifiable bundle fails closed", async () => {
  const cases = [
    [{ sharp: "0.35.4" }, /bundled next is missing/],
    [{ next: "16.4.0-canary.3", sharp: "0.35.4" }, /bundled next version "16\.4\.0-canary\.3" is not a final/],
    [{ next: { name: "next" }, sharp: "0.35.4" }, /bundled next version undefined is not a final/],
    [{ next: { name: "not-next", version: "99.0.0" }, sharp: "0.35.4" }, /names "not-next", not "next"/],
    [{ next: { raw: "{ not json" }, sharp: "0.35.4" }, /bundled next package\.json is not valid JSON/],
    [{ next: { raw: "null" }, sharp: "0.35.4" }, /names undefined, not "next"/],
  ];
  for (const [versions, expected] of cases) {
    await withRuntime(versions, async (root) => {
      await assert.rejects(checkBundledDependencyFloor(root), expected, JSON.stringify(versions));
    });
  }
});

test("one run reports every problem, not just the first", async () => {
  await withRuntime({ next: "16.3.1", sharp: "0.35.3" }, async (root) => {
    const { problems, versions } = await collectBundledDependencyFloorProblems(root);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /bundled next 16\.3\.1/);
    assert.match(problems[1], /bundled sharp 0\.35\.3/);
    assert.deepEqual(versions, { next: "16.3.1", sharp: "0.35.3" });
  });
});

test("a malformed floor refuses to run instead of passing", async () => {
  await withRuntime({ next: "16.3.8" }, async (root) => {
    await assert.rejects(
      checkBundledDependencyFloor(root, [{ name: "next", minimum: "16.3", reason: "fixture" }]),
      /floor for next is not a final version/,
    );
  });
});

test("the CLI checks an extracted artifact's runtime root and sets its exit status", async () => {
  const usage = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: bundled-dependency-floor\.mjs <runtime-root>/);

  await withRuntime({ next: "16.4.3", sharp: "0.35.5" }, async (patched) => {
    const ok = spawnSync(process.execPath, [SCRIPT, patched], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /bundled dependency floor ok .*next 16\.4\.3 >= 16\.4\.1, sharp 0\.35\.5 >= 0\.35\.4/);

    await withRuntime({ next: "16.3.1", sharp: "0.35.4" }, async (unpatched) => {
      const refused = spawnSync(process.execPath, [SCRIPT, patched, unpatched], { encoding: "utf8" });
      assert.equal(refused.status, 1, "any refused root must fail the whole check");
      assert.match(refused.stdout, /bundled dependency floor ok/);
      assert.match(refused.stderr, /bundled next 16\.3\.1 is below the patched minimum 16\.4\.1/);
    });
  });
});
