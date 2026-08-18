// @ts-nocheck
//
// Runtime behavior for the board card PATCH route's opsOutcome wiring
// (cave-onpeg): the route resolves it under updateCard's board lock via an
// output parameter (never a stale pre-write read) and only ever adds it to
// the response when the patch actually carried at least one addNormalizedUrl
// linkOp that resolved a nonempty outcome — so every unrelated PATCH caller
// (plain field patches, ordinary add/remove linkOps, other op kinds) keeps
// the exact `{ ok: true, card }` shape it always had.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const caveHome = await mkdtemp(path.join(tmpdir(), "cave-board-id-route-"));
process.env.HOME = caveHome;
process.env.COVEN_HOME = path.join(caveHome, ".coven");
process.env.COVEN_CAVE_HOME = caveHome;

const board = await import("../../../../lib/cave-board.ts");
const { POST: createCard } = await import("../route.ts");
const { PATCH } = await import("./route.ts");

assert.ok(
  board.BOARD_PATH.startsWith(caveHome),
  `refusing to run: BOARD_PATH (${board.BOARD_PATH}) is not under the temp home`,
);

function patchRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/api/board/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createTestCard(title: string): Promise<string> {
  const created = await createCard(new Request("http://127.0.0.1/api/board", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  }));
  assert.equal(created.status, 200);
  return (await created.json()).card.id as string;
}

function bodyKeys(body: Record<string, unknown>): string[] {
  return Object.keys(body).sort();
}

// ── normalized-only linkOps: opsOutcome is included with a nonempty report ──
{
  const id = await createTestCard("Normalized-only");
  const response = await PATCH(
    patchRequest({ ops: { linkOps: [{ op: "addNormalizedUrl", value: "https://One.dev/docs/#intro" }] } }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(bodyKeys(body), ["card", "ok", "opsOutcome"]);
  assert.deepEqual(body.opsOutcome, {
    linkOps: [{ requestedUrl: "https://One.dev/docs/#intro", normalizedUrl: "https://one.dev/docs", outcome: "added" }],
  });
  assert.ok(body.card.links.includes("https://one.dev/docs"));
}

// ── mixed normalized + ordinary linkOps: opsOutcome reports ONLY the
// addNormalizedUrl request, in its own request order — the ordinary add is
// applied to the card but has no client-facing added/duplicate/invalid
// distinction to report (see resolveLinkOpOutcomes's own doc comment). ──
{
  const id = await createTestCard("Mixed link ops");
  const response = await PATCH(
    patchRequest({
      ops: {
        linkOps: [
          { op: "add", value: "https://plain.dev" },
          { op: "addNormalizedUrl", value: "https://normalized.dev" },
        ],
      },
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(bodyKeys(body), ["card", "ok", "opsOutcome"]);
  assert.deepEqual(body.opsOutcome, {
    linkOps: [{ requestedUrl: "https://normalized.dev", normalizedUrl: "https://normalized.dev", outcome: "added" }],
  });
  assert.ok(body.card.links.includes("https://plain.dev"));
  assert.ok(body.card.links.includes("https://normalized.dev"));
}

// ── ordinary-only linkOps (the board inspector's own link editor): no
// addNormalizedUrl request exists to report on, so the response keeps the
// exact pre-existing `{ ok: true, card }` shape — no opsOutcome key at all,
// not a truthy-but-empty one. ──
{
  const id = await createTestCard("Ordinary-only link ops");
  const response = await PATCH(
    patchRequest({ ops: { linkOps: [{ op: "add", value: "https://ordinary.dev" }] } }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(bodyKeys(body), ["card", "ok"]);
  assert.equal(body.opsOutcome, undefined);
  assert.ok(body.card.links.includes("https://ordinary.dev"));
}

// ── other op kinds (no linkOps at all): same exact shape. ──
{
  const id = await createTestCard("Other ops only");
  const response = await PATCH(
    patchRequest({ ops: { labelOps: [{ op: "add", value: "triaged" }] } }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(bodyKeys(body), ["card", "ok"]);
  assert.equal(body.opsOutcome, undefined);
  assert.deepEqual(body.card.labels, ["triaged"]);
}

// ── no ops at all (a plain field patch): same exact shape. ──
{
  const id = await createTestCard("Plain patch");
  const response = await PATCH(
    patchRequest({ title: "Renamed" }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(bodyKeys(body), ["card", "ok"]);
  assert.equal(body.opsOutcome, undefined);
  assert.equal(body.card.title, "Renamed");
}

// ── blank addNormalizedUrl request: every string-valued addNormalizedUrl
// request gets a positional outcome, even blank/whitespace-only ones — the
// route must report it truthfully, not omit it. ──
{
  const id = await createTestCard("Blank addNormalizedUrl via route");
  const response = await PATCH(
    patchRequest({ ops: { linkOps: [{ op: "addNormalizedUrl", value: "   " }] } }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(bodyKeys(body), ["card", "ok", "opsOutcome"]);
  assert.deepEqual(body.opsOutcome, {
    linkOps: [{ requestedUrl: "   ", normalizedUrl: null, outcome: "invalid" }],
  });
  assert.deepEqual(body.card.links, [], "the blank addNormalizedUrl request never mutates stored links");
}

// ── malformed linkOps in untrusted PATCH JSON (a string, an object with a
// truthy `.length`, null, or an empty array) must not crash the route or
// mutate links, and must not populate opsOutcome — consistent with
// hasCardOps already ignoring non-array op collections (cave-onpeg). ──
for (const badLinkOps of ["not-an-array", { length: 1 }, null, []]) {
  const id = await createTestCard("Malformed linkOps via route");
  const response = await PATCH(
    patchRequest({ ops: { linkOps: badLinkOps } }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200, `malformed linkOps (${JSON.stringify(badLinkOps)}) must not error the route`);
  const body = await response.json();
  assert.deepEqual(
    bodyKeys(body),
    ["card", "ok"],
    `malformed linkOps (${JSON.stringify(badLinkOps)}) must keep the exact { ok, card } shape`,
  );
  assert.equal(body.opsOutcome, undefined);
  assert.deepEqual(
    body.card.links,
    [],
    `malformed linkOps (${JSON.stringify(badLinkOps)}) must never mutate stored links`,
  );
}

// A mixed patch — malformed linkOps alongside a valid op kind — still
// applies the valid op and leaves the malformed linkOps container inert.
{
  const id = await createTestCard("Mixed malformed linkOps via route");
  const response = await PATCH(
    patchRequest({ ops: { labelOps: [{ op: "add", value: "triaged" }], linkOps: { length: 1 } } }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(bodyKeys(body), ["card", "ok"]);
  assert.equal(body.opsOutcome, undefined);
  assert.deepEqual(body.card.labels, ["triaged"], "the valid labelOps still applies alongside the malformed linkOps container");
  assert.deepEqual(body.card.links, [], "the malformed linkOps container in the mixed patch never mutates links");
}

// ── Static guard, kept alongside the runtime coverage above: opsOutcome must
// never be inferred from a second, potentially stale board read — it has to
// come from updateCard's own output parameter, resolved under its lock. ──
const source = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
assert.doesNotMatch(
  source,
  /loadBoard\(\)\)\.cards\.find\([^)]*\)[\s\S]{0,200}opsOutcome/,
  "opsOutcome must never be inferred from a second, potentially stale board read",
);

console.log("board [id] route: ok");
