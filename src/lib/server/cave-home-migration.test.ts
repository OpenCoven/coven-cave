// @ts-nocheck
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Isolated to a temp COVEN_HOME so it never touches the real ~/.coven.
const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-home-migration-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");
delete process.env.COVEN_CAVE_HOME;

const covenDir = process.env.COVEN_HOME;
const caveDir = path.join(covenDir, "cave");

const { migrateCaveHome, CAVE_HOME_MIGRATIONS } = await import("./cave-home-migration.ts");
const { caveHome } = await import("../coven-paths.ts");

// SAFETY GATE — never operate outside the temp home.
assert.ok(caveHome().startsWith(tmpHome), `refusing: caveHome ${caveHome()} not under temp home`);

async function pathKind(target) {
  try {
    const st = await lstat(target);
    return st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : "file";
  } catch {
    return "missing";
  }
}

try {
  // Fresh home, nothing to migrate — just creates the cave dir.
  {
    const result = await migrateCaveHome();
    assert.deepEqual(result.moved, [], "nothing moved on a fresh home");
    assert.deepEqual(result.errors, [], "no errors on a fresh home");
    assert.equal(await pathKind(caveDir), "dir", "cave home is created");
  }

  // Seed a representative legacy layout: files, the conversations dir, and a
  // daemon-owned sibling that must NOT move.
  await writeFile(path.join(covenDir, "cave-config.json"), '{"version":1}', "utf8");
  await writeFile(path.join(covenDir, "cave-board.json"), '{"cards":[]}', "utf8");
  await mkdir(path.join(covenDir, "cave-conversations"), { recursive: true });
  await writeFile(path.join(covenDir, "cave-conversations", "sess-1.json"), "{}", "utf8");
  await writeFile(path.join(covenDir, "cave-coven-calls.json"), "[]", "utf8"); // daemon-owned

  {
    const result = await migrateCaveHome();
    assert.deepEqual(
      [...result.moved].sort(),
      ["cave-board.json", "cave-config.json", "cave-conversations"],
      "moves exactly the seeded cave-owned entries",
    );
    assert.deepEqual(result.errors, [], "no errors");

    // Files land under cave/ with standardized names, content intact.
    assert.equal(await readFile(path.join(caveDir, "config.json"), "utf8"), '{"version":1}');
    assert.equal(await readFile(path.join(caveDir, "board.json"), "utf8"), '{"cards":[]}');
    assert.equal(
      await readFile(path.join(caveDir, "conversations", "sess-1.json"), "utf8"),
      "{}",
      "conversation files move with their dir",
    );

    // Daemon-owned sibling untouched.
    assert.equal(await pathKind(path.join(covenDir, "cave-coven-calls.json")), "file");

    // Compat symlinks bridge the legacy paths (best-effort; POSIX here).
    assert.equal(await pathKind(path.join(covenDir, "cave-config.json")), "symlink");
    const linkTarget = await readlink(path.join(covenDir, "cave-config.json"));
    assert.equal(linkTarget, path.join("cave", "config.json"), "relative link into cave/");
    assert.equal(
      await readFile(path.join(covenDir, "cave-config.json"), "utf8"),
      '{"version":1}',
      "legacy path still resolves through the link",
    );
  }

  // Idempotent: a second run skips symlinked legacy paths and moves nothing.
  {
    const result = await migrateCaveHome();
    assert.deepEqual(result.moved, [], "second run moves nothing");
    assert.deepEqual(result.errors, [], "second run has no errors");
  }

  // Destination wins: a legacy REAL file alongside an existing destination is
  // left in place, and the destination is not clobbered.
  {
    await rm(path.join(covenDir, "cave-state.json"), { force: true });
    await writeFile(path.join(covenDir, "cave-state.json"), '{"legacy":true}', "utf8");
    await writeFile(path.join(caveDir, "state.json"), '{"current":true}', "utf8");
    const result = await migrateCaveHome();
    assert.ok(!result.moved.includes("cave-state.json"), "conflicting legacy file is not moved");
    assert.equal(
      await readFile(path.join(caveDir, "state.json"), "utf8"),
      '{"current":true}',
      "existing destination wins",
    );
    assert.equal(
      await readFile(path.join(covenDir, "cave-state.json"), "utf8"),
      '{"legacy":true}',
      "conflicting legacy file left for inspection",
    );
  }

  // The manifest never claims daemon-owned ledgers.
  for (const entry of CAVE_HOME_MIGRATIONS) {
    assert.ok(
      !["cave-calendar.json", "cave-coven-calls.json", "cave-voice-calls.json"].includes(entry.legacy),
      `manifest must not claim daemon-owned ${entry.legacy}`,
    );
  }

  console.log("cave-home-migration.test.ts: ok");
} finally {
  await rm(tmpHome, { recursive: true, force: true });
}
