import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Point the store at a scratch Cave home BEFORE importing it — the module
// resolves board.json from caveHome() at import time. Never let this suite
// touch a real ~/.coven board; these tests delete cards.
const home = await mkdtemp(path.join(tmpdir(), "cave-board-retention-"));
process.env.COVEN_CAVE_HOME = home;
const BOARD = path.join(home, "board.json");

const { deleteCard, restoreCards, cardForBeadRef, loadBoard } = await import("./cave-board.ts");

const ISO = "2026-08-09T00:00:00.000Z";
const card = (over: Record<string, unknown> = {}) => ({
  id: "c-plain",
  title: "Plain card",
  notes: "",
  status: "done",
  priority: "medium",
  familiarId: null,
  sessionId: null,
  cwd: null,
  links: [],
  github: [],
  asana: [],
  labels: [],
  createdAt: ISO,
  updatedAt: ISO,
  lifecycle: "completed",
  lifecycleAt: ISO,
  retryCount: 0,
  maxRetries: 3,
  steps: [],
  ...over,
});

const LINKED = card({
  id: "c-linked",
  title: "Linked mirror",
  beadRef: { id: "cave-abc12", projectId: "proj-1" },
});

async function seed(cards: unknown[]) {
  await mkdir(path.dirname(BOARD), { recursive: true });
  await writeFile(BOARD, JSON.stringify({ version: 1, cards }), "utf8");
}
const ids = async () => (await loadBoard()).cards.map((c) => c.id).sort();

// ── Retention: a linked mirror survives routine deletion ────────────────────
await seed([card(), LINKED]);
assert.equal(await deleteCard("c-linked"), "linked", "a linked card is refused, not deleted");
assert.deepEqual(await ids(), ["c-linked", "c-plain"], "the refused card is still on the board");

assert.equal(await deleteCard("c-plain"), "deleted", "an unlinked card deletes normally");
assert.deepEqual(await ids(), ["c-linked"]);

assert.equal(await deleteCard("c-missing"), "not-found", "a missing id is distinguishable from a refusal");

// The explicit stronger action is the only way past the guard.
assert.equal(
  await deleteCard("c-linked", { allowLinked: true }),
  "deleted",
  "an explicit unlink-and-delete removes the linked card",
);
assert.deepEqual(await ids(), []);

// ── A malformed ref is not a link ───────────────────────────────────────────
// Both halves are required: a half-written ref must not make a card permanently
// undeletable, which would be a worse failure than the one being fixed.
for (const bad of [{ id: "cave-abc12" }, { projectId: "proj-1" }, { id: "", projectId: "p" }, "nope", null]) {
  await seed([card({ id: "c-bad", beadRef: bad })]);
  assert.equal(await deleteCard("c-bad"), "deleted", `beadRef ${JSON.stringify(bad)} is not a link`);
}

// ── Restore: same id, full fields ───────────────────────────────────────────
const rich = card({
  id: "c-rich",
  title: "Rich card",
  notes: "kept",
  beadRef: { id: "cave-zzz99", projectId: "proj-9" },
  asana: [{
    id: "asana-1",
    kind: "task",
    gid: "1201",
    title: "Ship retention",
    url: "https://app.asana.com/0/1200/1201",
  }],
  labels: ["alpha", "beta"],
  steps: [{ id: "s1", text: "step one", done: true, addedAt: ISO, doneAt: ISO }],
  retryCount: 2,
  maxRetries: 5,
  createdAt: "2026-01-01T00:00:00.000Z",
});
await seed([rich]);
const stored = (await loadBoard()).cards[0];
assert.equal(await deleteCard("c-rich", { allowLinked: true }), "deleted");
assert.deepEqual(await ids(), [], "precondition: the card is gone");

const result = await restoreCards([stored]);
assert.deepEqual(result.restored, ["c-rich"], "restore reports what it put back");
assert.deepEqual(result.skipped, []);

const back = (await loadBoard()).cards[0];
assert.equal(back.id, "c-rich", "the ORIGINAL id is restored — the whole point");
assert.equal(back.createdAt, "2026-01-01T00:00:00.000Z", "createdAt is not reset to now");
assert.deepEqual(back.beadRef, { id: "cave-zzz99", projectId: "proj-9" }, "the Bead link survives");
assert.equal(back.asana.length, 1, "Asana links survive (the create path drops them entirely)");
assert.deepEqual(back.labels, ["alpha", "beta"]);
assert.equal(back.retryCount, 2);
assert.equal(back.maxRetries, 5);
assert.equal(back.steps[0]?.done, true, "step STATE survives, not just step text");
assert.equal(back.steps[0]?.doneAt, ISO);
// The strongest statement available: the restored record equals the stored one.
// Name the offending field — "objects differ" is useless when a card has ~30 of
// them and the printed dump elides the one that matters.
const differsOn = (a: unknown, b: unknown, keys: string[]) =>
  keys.filter(
    (key) =>
      JSON.stringify((a as Record<string, unknown>)[key])
      !== JSON.stringify((b as Record<string, unknown>)[key]),
  );
const allKeys = [...new Set([...Object.keys(stored), ...Object.keys(back)])];
// `asana` is excluded ONLY because of cave-0b8t8: backfillCard is not
// idempotent, so a stored Asana title is replaced by a generated one on the
// NEXT load — restore writes the record back verbatim and the read still
// differs. That is a pre-existing board-normalization defect, not a restore
// defect, and it is asserted against separately below so this exclusion cannot
// quietly hide a regression in the link itself.
const differing = differsOn(stored, back, allKeys.filter((k) => k !== "asana"));
assert.deepEqual(
  differing,
  [],
  `a restored card is indistinguishable from the stored one; differing: ${differing
    .map((k) => `${k} ${JSON.stringify((stored as Record<string, unknown>)[k])} -> ${JSON.stringify((back as Record<string, unknown>)[k])}`)
    .join(" | ")}`,
);
// The Asana link's IDENTITY must still survive a restore — only its title is
// subject to cave-0b8t8.
assert.deepEqual(
  differsOn(stored.asana[0], back.asana[0], ["id", "kind", "gid", "url", "projectGid"]),
  [],
  "a restored Asana link keeps its identity",
);

// ── Restore never clobbers a live card ──────────────────────────────────────
const live = (await loadBoard()).cards[0];
const impostor = { ...live, title: "Should not win" };
const second = await restoreCards([impostor]);
assert.deepEqual(second.restored, [], "a live id is not restored over");
assert.deepEqual(second.skipped, ["c-rich"], "and is reported as skipped");
assert.equal((await loadBoard()).cards[0].title, "Rich card", "the live card is untouched");

// ── Bead → card resolution needs no prose ───────────────────────────────────
const cards = (await loadBoard()).cards;
assert.equal(cardForBeadRef(cards, "cave-zzz99")?.id, "c-rich", "a closed Bead resolves to its live card");
assert.equal(cardForBeadRef(cards, "cave-nope"), null);
assert.equal(cardForBeadRef(cards, ""), null, "an empty id never matches a card");

// ── The board file is still well-formed after all of it ─────────────────────
const raw = JSON.parse(await readFile(BOARD, "utf8"));
assert.equal(raw.version, 1);
assert.equal(Array.isArray(raw.cards), true);

console.log("cave-board-retention.test.ts ok");
