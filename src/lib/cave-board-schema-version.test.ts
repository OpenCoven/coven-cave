import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// The board file's schema discriminant (#6258): a version 1 board predates the
// canonical task fields, so a card without a `dependencies` array is marked as
// predating them, and repair diagnostics tell it from a task that never had a
// blocker. The marker survives the upgrade save and only a dependency write
// clears it.

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-schema-version-"));
process.env.HOME = tmpHome;
process.env.COVEN_CAVE_HOME = tmpHome;
const BOARD = path.join(tmpHome, "board.json");

const at = "2026-08-01T12:00:00.000Z";
const base = {
  notes: "",
  priority: "medium",
  familiarId: null,
  sessionId: null,
  cwd: null,
  links: [],
  github: [],
  asana: [],
  labels: [],
  createdAt: at,
  updatedAt: at,
};
await mkdir(tmpHome, { recursive: true });
await writeFile(
  BOARD,
  JSON.stringify({
    version: 1,
    cards: [
      { ...base, id: "predates", title: "Blocked before dependencies existed", status: "blocked" },
      { ...base, id: "tracked", title: "Tracked with no blockers", status: "backlog", dependencies: [] },
      { ...base, id: "idle", title: "Backlog before dependencies existed", status: "backlog" },
    ],
  }),
);

const board = await import("./cave-board.ts");
const orchestration = await import("./task-orchestration.ts");

const byId = (cards: readonly { id: string }[], id: string) => {
  const found = cards.find((card) => card.id === id);
  assert.ok(found, `card ${id} loads`);
  return found as Awaited<ReturnType<typeof board.loadBoard>>["cards"][number];
};

// ── Reading a version 1 board ────────────────────────────────────────────────

const first = await board.loadBoard();
assert.equal(board.BOARD_SCHEMA_VERSION, 2);
assert.equal(first.version, 2, "a version 1 board reads as the current schema");
assert.equal(byId(first.cards, "predates").predatesDependencies, true, "no dependencies field: predates it");
assert.equal(
  "predatesDependencies" in byId(first.cards, "tracked"),
  false,
  "an empty dependencies array is a task that never had blockers",
);

// ── Repair diagnostics tell the two apart ────────────────────────────────────

const predates = byId(first.cards, "predates");
const [legacyRepair] = orchestration.repairRecommendations(predates, first.cards);
assert.equal(legacyRepair?.code, "blocked_requires_dependency");
assert.match(legacyRepair.action, /predates dependency tracking/);
const { predatesDependencies: _marker, ...unmarked } = predates;
const [plainRepair] = orchestration.repairRecommendations(unmarked, first.cards);
assert.equal(plainRepair?.action, "Name what blocks this task, or move it out of Blocked.");

// ── The upgrade save keeps the marker ────────────────────────────────────────

await board.updateCard("tracked", { title: "Tracked, renamed" });
const saved = JSON.parse(await readFile(BOARD, "utf8")) as {
  version: number;
  cards: Array<{ id: string; predatesDependencies?: unknown }>;
};
assert.equal(saved.version, 2, "the next save writes the discriminant");
assert.equal(saved.cards.find((card) => card.id === "predates")?.predatesDependencies, true);
assert.equal("predatesDependencies" in (saved.cards.find((card) => card.id === "tracked") ?? {}), false);

const second = await board.loadBoard();
assert.equal(
  byId(second.cards, "predates").predatesDependencies,
  true,
  "the marker is read back from a version 2 board, not re-derived",
);

// ── Mutators own the marker ──────────────────────────────────────────────────

const renamed = await board.updateCard("idle", { title: "Still predates" });
assert.equal(renamed?.predatesDependencies, true, "a write that leaves dependencies alone keeps it");
await assert.rejects(
  board.updateCard("predates", { title: "Renamed while incomplete" }),
  "a legacy blocked card's next write still owes the blocked triple (I8)",
);

const forged = await board.updateCard("tracked", { predatesDependencies: true } as never);
assert.equal("predatesDependencies" in (forged ?? {}), false, "no patch can set the marker");

const settled = await board.updateCard("predates", { status: "backlog", dependencies: [] });
assert.equal("predatesDependencies" in (settled ?? {}), false, "naming the dependencies settles it");
const third = await board.loadBoard();
assert.equal("predatesDependencies" in byId(third.cards, "predates"), false);

const created = await board.createCard({ title: "New task", predatesDependencies: true } as never);
assert.equal("predatesDependencies" in created, false, "a new card is never legacy");

// ── A stray value on a version 2 board is dropped, and a newer board keeps its version ──

await writeFile(
  BOARD,
  JSON.stringify({
    version: 3,
    cards: [{ ...base, id: "stray", title: "Stray marker", status: "backlog", predatesDependencies: "yes" }],
  }),
);
const newer = await board.loadBoard();
assert.equal(newer.version, 3, "a board from a newer schema is not downgraded");
assert.equal("predatesDependencies" in byId(newer.cards, "stray"), false, "only `true` is a marker");

console.log("cave-board schema version: ok");
