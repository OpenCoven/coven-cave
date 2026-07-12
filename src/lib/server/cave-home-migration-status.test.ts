// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Isolated to a temp COVEN_HOME so it never touches the real ~/.coven.
const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-home-migration-status-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");
delete process.env.COVEN_CAVE_HOME;

const covenDir = process.env.COVEN_HOME;
const caveDir = path.join(covenDir, "cave");

const { caveHomeMigrationStatus } = await import("./cave-home-migration-status.ts");
const { caveHome } = await import("../coven-paths.ts");

// SAFETY GATE — never operate outside the temp home.
assert.ok(caveHome().startsWith(tmpHome), `refusing: caveHome ${caveHome()} not under temp home`);

try {
  // Fresh home: nothing legacy, machine does not qualify for the banner.
  {
    const status = await caveHomeMigrationStatus();
    assert.deepEqual(status.pending, [], "fresh home has nothing pending");
    assert.deepEqual(status.conflicts, [], "fresh home has no conflicts");
    assert.equal(status.migrated, true, "fresh home reads as migrated");
  }

  await mkdir(caveDir, { recursive: true });

  // A real legacy file with a free destination is PENDING — the banner's
  // "Migrate now" button can move it.
  await writeFile(path.join(covenDir, "cave-config.json"), '{"version":1}', "utf8");
  // A legacy file whose destination already exists is a CONFLICT — destination
  // wins by design, left for manual review.
  await writeFile(path.join(covenDir, "cave-state.json"), '{"legacy":true}', "utf8");
  await writeFile(path.join(caveDir, "state.json"), '{"current":true}', "utf8");
  // A symlinked legacy path is an already-migrated compat bridge — not counted.
  await writeFile(path.join(caveDir, "board.json"), '{"cards":[]}', "utf8");
  await symlink(path.join("cave", "board.json"), path.join(covenDir, "cave-board.json"));
  // A daemon-owned sibling sharing the prefix is out of manifest scope.
  await writeFile(path.join(covenDir, "cave-coven-calls.json"), "[]", "utf8");

  {
    const status = await caveHomeMigrationStatus();
    assert.deepEqual(status.pending, ["cave-config.json"], "movable legacy file is pending");
    assert.deepEqual(status.conflicts, ["cave-state.json"], "occupied destination is a conflict");
    assert.equal(status.migrated, false, "legacy leftovers mean not migrated");
  }

  // After the pending file moves (destination filled, legacy bridged), only
  // the conflict remains — pending clears, so the banner clears with it.
  await rm(path.join(covenDir, "cave-config.json"));
  await writeFile(path.join(caveDir, "config.json"), '{"version":1}', "utf8");
  await symlink(path.join("cave", "config.json"), path.join(covenDir, "cave-config.json"));

  {
    const status = await caveHomeMigrationStatus();
    assert.deepEqual(status.pending, [], "bridged legacy path is no longer pending");
    assert.deepEqual(status.conflicts, ["cave-state.json"], "conflict persists until manual review");
    assert.equal(status.migrated, false, "conflicts still count as unmigrated");
  }

  console.log("cave-home-migration-status.test.ts: ok");
} finally {
  await rm(tmpHome, { recursive: true, force: true });
}
