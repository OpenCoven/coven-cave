// POST /api/board/enrich-steps under every upstream GitHub anomaly (#6359).
//
// The route's only upstream call is the per-link issue read inside
// `fetchGitHubIssueStates`, reached through the streaming POST after the
// board, config and trusted-harness checks. The model step is stubbed out
// below by pointing COVEN_BIN at a no-op executable, so a run parses no task
// metadata and the only thing that can change a card is the GitHub state.
// That makes the contract observable from the stream: a healthy GitHub
// refreshes the linked issue and the card is written (`done`); a degraded
// GitHub leaves the link untouched and the task is reported as reviewed with
// nothing to write (`skip: no_task_metadata_parsed`). Nothing ever surfaces
// as `skip: error`, the stream always completes, and the next run after
// GitHub heals reads it again.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("board-enrich-steps-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_0123456789abcdef";
process.env.GITHUB_PAT = TOKEN;

// The model step: a Coven CLI that answers nothing, so no task metadata is
// ever parsed and GitHub state is the only input that can change the card.
const stubBin = path.join(home.root, "coven-stub");
writeFileSync(stubBin, "#!/bin/sh\nexit 0\n");
chmodSync(stubBin, 0o755);
process.env.COVEN_BIN = stubBin;

const CARD_ID = "card-1";
const boardPath = path.join(home.caveHome, "board.json");
mkdirSync(home.caveHome, { recursive: true });
writeFileSync(boardPath, JSON.stringify({
  version: 2,
  cards: [{
    id: CARD_ID,
    title: "Ship the anomaly suite",
    notes: "",
    status: "backlog",
    priority: "medium",
    familiarId: "fam",
    sessionId: null,
    cwd: null,
    links: [],
    github: [{
      id: "github:issue:o/r:7",
      kind: "issue",
      repo: "o/r",
      number: 7,
      title: "o/r #7",
      url: "https://github.com/o/r/issues/7",
      state: "open",
      labels: [],
    }],
    asana: [],
    labels: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    lifecycle: "queued",
    lifecycleAt: "2026-11-01T00:00:00.000Z",
    retryCount: 0,
    maxRetries: 0,
    steps: [],
  }],
}));

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

// Every healthy answer is a newer GitHub revision, so each healthy run has
// something to write and is told apart from a run that saw nothing new.
let revision = 0;
harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  if (request.method === "GET" && url.pathname === "/repos/o/r/issues/7") {
    revision += 1;
    return Response.json({
      title: `Refreshed title ${revision}`,
      state: "closed",
      state_reason: "completed",
      labels: [{ name: "bug" }, { name: "p1" }],
      updated_at: `2026-11-01T08:${String(revision).padStart(2, "0")}:00Z`,
      html_url: "https://github.com/o/r/issues/7",
    });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

type Event = { kind: string; cardId?: string; reason?: string; message?: string; total?: number };

const enrich = () =>
  POST(
    new Request("http://localhost/api/board/enrich-steps", {
      method: "POST",
      headers: { "content-type": "application/json", "x-coven-cave-intent": "board-enrich-steps" },
      body: JSON.stringify({ intent: "board-enrich-steps", familiarId: "fam" }),
    }),
  );

function events(outcome: MatrixOutcome): Event[] {
  assert.equal(outcome.status, 200, outcome.text);
  assert.match(outcome.response?.headers.get("content-type") ?? "", /x-ndjson/);
  return outcome.text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Event);
}

function savedLink() {
  const board = JSON.parse(readFileSync(boardPath, "utf8")) as { cards: Array<{ id: string; github: Array<Record<string, unknown>> }> };
  return board.cards.find((card) => card.id === CARD_ID)?.github[0];
}

/** The stream ran to completion over the one card and never reported an error. */
function completed(outcome: MatrixOutcome): Event[] {
  const seen = events(outcome);
  assert.deepEqual(seen[0], { kind: "start", total: 1 });
  assert.deepEqual(seen.at(-1), { kind: "complete" });
  assert.equal(seen.find((event) => event.kind === "skip" && event.reason === "error"), undefined, `a GitHub failure surfaced as an error: ${outcome.text}`);
  return seen;
}

test("POST /api/board/enrich-steps across upstream GitHub anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: enrich,
    healthy: (outcome) => {
      const seen = completed(outcome);
      assert.ok(seen.some((event) => event.kind === "done" && event.cardId === CARD_ID), `a healthy read refreshes the card: ${outcome.text}`);
      const link = savedLink();
      assert.ok(link);
      assert.equal(link.state, "closed");
      assert.equal(link.stateReason, "completed");
      assert.equal(link.title, `Refreshed title ${revision}`);
      assert.deepEqual(link.labels, ["bug", "p1"]);
      assert.equal(harness.calls("github").length, 1, "one read per linked issue");
    },
    degraded: {
      default: (outcome) => {
        const seen = completed(outcome);
        const before = savedLink();
        assert.deepEqual(
          seen.filter((event) => event.kind === "skip"),
          [{ kind: "skip", cardId: CARD_ID, reason: "no_task_metadata_parsed" }],
          `a degraded read leaves the link as it was: ${outcome.text}`,
        );
        assert.equal(seen.find((event) => event.kind === "done"), undefined, "nothing is written from a degraded read");
        assert.equal(before?.state, "closed", "the last good state is kept, not blanked");
        assert.equal(before?.title, `Refreshed title ${revision}`);
      },
      "schema-drift": (outcome) => {
        // Pinned, not endorsed: a well-formed 200 of the wrong shape passes the
        // `res.ok && data` check and is folded into the link. Fields the body
        // lacks keep their stored value — except labels, which are rebuilt
        // from the missing field and wiped. The write that results is what
        // makes this a `done`, not a skip.
        const seen = completed(outcome);
        assert.ok(seen.some((event) => event.kind === "done" && event.cardId === CARD_ID), outcome.text);
        const link = savedLink();
        assert.equal(link?.state, "closed");
        assert.equal(link?.title, `Refreshed title ${revision}`);
        assert.deepEqual(link?.labels, [], "a drifted body erases the stored labels (finding)");
      },
    },
  });
});

test("a 404 (deleted or private issue) keeps the stored link rather than erasing it", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  completed(await captureStream());
  assert.equal(savedLink()?.title, `Refreshed title ${revision}`);
  harness.heal("github");
});

test("the issue reads carry no deadline (finding, not a contract)", async () => {
  assert.ok(harness.calls("github").length >= 1);
  assert.ok(harness.calls("github").every((call) => call.hasDeadline === false));
});

async function captureStream(): Promise<MatrixOutcome> {
  const response = await enrich();
  const text = await response.clone().text();
  return { value: response, response, status: response.status, text, body: undefined, threw: undefined };
}
