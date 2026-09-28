// @ts-nocheck
// #5690: GET /api/board leaves out Enhance proposal history; GET /api/board/<id>
// returns the card in full.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "board-lean-list-"));
process.env.HOME = home;
process.env.COVEN_HOME = path.join(home, ".coven");
process.env.COVEN_CAVE_HOME = home;

const BOARD_PATH = path.join(home, "board.json");
const proposal = { id: "prop-1", state: "blocked", needsHuman: true, context: { fingerprint: "fp", cardUpdatedAt: "2026-09-28T00:00:00Z", taskIds: [], githubRefs: [] } };
writeFileSync(BOARD_PATH, JSON.stringify({
  version: 1,
  cards: [{
    id: "card-1",
    title: "Enhanced task",
    notes: "",
    status: "backlog",
    lifecycle: "queued",
    priority: "medium",
    familiarId: null,
    sessionId: null,
    cwd: null,
    projectId: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    steps: [],
    needsHuman: false,
    createdAt: "2026-09-28T00:00:00Z",
    updatedAt: "2026-09-28T00:00:00Z",
    agenticEnhance: { proposals: [proposal], audit: [{ proposalId: "prop-1", action: "blocked" }] },
  }],
}));

const list = await import("./route.ts");
const item = await import("./[id]/route.ts");
const paramsFor = (id) => ({ params: Promise.resolve({ id }) });

const listJson = await (await list.GET()).json();
assert.equal(listJson.ok, true);
assert.equal(listJson.cards.length, 1);
assert.equal(listJson.cards[0].title, "Enhanced task");
assert.equal("agenticEnhance" in listJson.cards[0], false, "the list leaves out Enhance history");

const itemRes = await item.GET(new Request("http://cave.test/api/board/card-1"), paramsFor("card-1"));
assert.equal(itemRes.status, 200);
const itemJson = await itemRes.json();
assert.equal(itemJson.card.id, "card-1");
assert.equal(itemJson.card.agenticEnhance.proposals[0].id, "prop-1", "the single card is complete");
assert.equal(itemJson.card.agenticEnhance.audit.length, 1);

const missing = await item.GET(new Request("http://cave.test/api/board/nope"), paramsFor("nope"));
assert.equal(missing.status, 404);

assert.equal(
  JSON.parse(readFileSync(BOARD_PATH, "utf8")).cards[0].agenticEnhance.proposals.length,
  1,
  "reading the lean list never rewrites stored history",
);

console.log("board-list-lean-route.test.ts: ok");
