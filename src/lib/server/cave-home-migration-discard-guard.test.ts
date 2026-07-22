// @ts-nocheck
// Discard guard (cave-5ax2): a keep-canonical/recover-legacy resolution that
// would replace a dramatically larger copy with a much smaller one must be
// blocked until the caller confirms. Regression for the 2026-07-22 incident
// where recover-legacy replaced a 206-card canonical board with a 3-card
// stale legacy file.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
const { migrateCaveHome } = await import("./cave-home-migration.ts");
const { caveHomeMigrationStatus } = await import("./cave-home-migration-status.ts");

async function home(name: string) {
  const root = await mkdtemp(path.join(tmpdir(), `cave-home-${name}-`));
  roots.push(root);
  process.env.COVEN_HOME = path.join(root, ".coven");
  delete process.env.COVEN_CAVE_HOME;
  delete process.env.COVEN_PREFERENCES_PATH;
  delete process.env.COVEN_THEME_PATH;
  delete process.env.COVEN_BACKDROP_PATH;
  await mkdir(process.env.COVEN_HOME, { recursive: true });
  return { root, coven: process.env.COVEN_HOME, cave: path.join(process.env.COVEN_HOME, "cave") };
}

async function json(target: string) {
  return JSON.parse(await readFile(target, "utf8"));
}

const bigBoard = () => ({
  version: 1,
  cards: Array.from({ length: 200 }, (_, index) => ({
    id: `card-${index}`,
    title: `Task ${index} with enough descriptive text to give the canonical board realistic weight`,
    status: "backlog",
    createdAt: "2026-07-01T00:00:00.000Z",
  })),
});

const smallBoard = () => ({
  version: 1,
  cards: [{ id: "only-card", title: "Fresh card on the stale side", status: "backlog" }],
});

try {
  // recover-legacy that would discard a much larger canonical copy is blocked
  // until confirmed; the canonical file is untouched and the guard reason is
  // durable in the journal/status summary.
  {
    const { coven, cave } = await home("guard-recover-legacy");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-board.json"), JSON.stringify(smallBoard()), "utf8");
    await writeFile(path.join(cave, "board.json"), JSON.stringify(bigBoard()), "utf8");

    const blocked = await migrateCaveHome({ legacy: "cave-board.json", action: "recover-legacy" });
    assert.deepEqual(blocked.errors, []);
    assert.equal(blocked.resolved.includes("cave-board.json"), false);
    assert.equal(blocked.confirmationRequired.length, 1);
    const guard = blocked.confirmationRequired[0];
    assert.equal(guard.legacy, "cave-board.json");
    assert.equal(guard.action, "recover-legacy");
    assert.ok(guard.discardedBytes > guard.keptBytes * 8, "guard reports the size imbalance");
    assert.match(guard.summary, /discard the canonical copy/);
    assert.match(guard.summary, /recovery bundle/);

    const canonical = await json(path.join(cave, "board.json"));
    assert.equal(canonical.cards.length, 200, "canonical copy must remain untouched while blocked");

    const status = await caveHomeMigrationStatus();
    assert.equal(status.conflicts.includes("cave-board.json"), true);
    const detail = status.details.find((entry) => entry.legacy === "cave-board.json");
    assert.match(detail.summary, /Blocked without confirmation/);
    assert.equal(typeof detail.legacySize, "number", "status reports the legacy size for review");
    assert.equal(typeof detail.canonicalSize, "number", "status reports the canonical size for review");
    assert.ok(detail.actions.includes("recover-legacy"), "the action stays available for a confirmed retry");

    // The same action with explicit confirmation proceeds and keeps the
    // verified recovery bundle for the discarded copy.
    const confirmed = await migrateCaveHome({ legacy: "cave-board.json", action: "recover-legacy", confirmDiscard: true });
    assert.deepEqual(confirmed.errors, []);
    assert.deepEqual(confirmed.confirmationRequired, []);
    assert.equal(confirmed.resolved.includes("cave-board.json"), true);
    const recovered = await json(path.join(cave, "board.json"));
    assert.equal(recovered.cards.length, 1, "confirmed recover-legacy installs the legacy copy");
    assert.ok(confirmed.backedUp.length + blocked.backedUp.length > 0, "a recovery bundle preserved both copies");
  }

  // keep-canonical is guarded symmetrically when the legacy copy is the much
  // larger side.
  {
    const { coven, cave } = await home("guard-keep-canonical");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-board.json"), JSON.stringify(bigBoard()), "utf8");
    await writeFile(path.join(cave, "board.json"), JSON.stringify(smallBoard()), "utf8");

    const blocked = await migrateCaveHome({ legacy: "cave-board.json", action: "keep-canonical" });
    assert.equal(blocked.confirmationRequired.length, 1);
    assert.equal(blocked.confirmationRequired[0].action, "keep-canonical");
    assert.match(blocked.confirmationRequired[0].summary, /discard the legacy copy/);

    const confirmed = await migrateCaveHome({ legacy: "cave-board.json", action: "keep-canonical", confirmDiscard: true });
    assert.deepEqual(confirmed.errors, []);
    assert.equal(confirmed.resolved.includes("cave-board.json"), true);
    assert.equal((await json(path.join(cave, "board.json"))).cards.length, 1);
  }

  // Comparable sizes stay below the guard: explicit choices resolve without
  // any confirmation round-trip, preserving the existing one-click flow.
  {
    const { coven, cave } = await home("guard-balanced");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-board.json"), JSON.stringify({ version: 1, cards: [{ id: "a", title: "left" }] }), "utf8");
    await writeFile(path.join(cave, "board.json"), JSON.stringify({ version: 1, cards: [{ id: "b", title: "right" }] }), "utf8");

    const resolved = await migrateCaveHome({ legacy: "cave-board.json", action: "recover-legacy" });
    assert.deepEqual(resolved.errors, []);
    assert.deepEqual(resolved.confirmationRequired, []);
    assert.equal(resolved.resolved.includes("cave-board.json"), true);
    assert.equal((await json(path.join(cave, "board.json"))).cards[0].id, "a");
  }

  console.log("cave-home-migration-discard-guard.test.ts: ok");
} finally {
  delete process.env.COVEN_HOME;
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
