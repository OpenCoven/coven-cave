// @ts-nocheck
// Route tests for DELETE /api/chat/conversation/[id] — the voice new-chat
// discard fix (Finding 1 of the whole-implementation review). COVEN_CAVE_HOME
// (and CONV_DIR/STATE_PATH derived from it) is computed once at module load
// by cave-conversations.ts/cave-config.ts, so both env vars below must be set
// BEFORE route.ts is imported — a static import would hoist above the
// assignment and point every call at the real ~/.coven store (same hazard
// documented in cave-canvas.test.ts), so route.ts is imported dynamically.
//
// COVEN_HOME also needs isolating, not just COVEN_CAVE_HOME: the default
// DELETE path calls sacrificeSessionLocal, which goes through cave-config.ts's
// withCaveHomeReconciledStore. That reconciliation compares legacy paths
// under covenHome() (~/.coven by default) against the canonical store under
// the overridden caveHome() — on a machine where ~/.coven still has the old
// top-level compat symlinks (cave-state.json -> cave/state.json, etc.), that
// mismatch throws "legacy symlink does not target canonical storage" unless
// COVEN_HOME is pointed at an empty temp dir too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "conversation-id-route-"));
const TMP_COVEN = mkdtempSync(join(tmpdir(), "conversation-id-route-coven-"));
process.env.COVEN_CAVE_HOME = TMP;
process.env.COVEN_HOME = TMP_COVEN;

const CONV_DIR = join(TMP, "conversations");
const STATE_PATH = join(TMP, "state.json");
const BOARD_PATH = join(TMP, "board.json");

function writeConversation(id: string, turns: unknown[] = []) {
  mkdirSync(CONV_DIR, { recursive: true });
  writeFileSync(
    join(CONV_DIR, `${id}.json`),
    JSON.stringify({
      sessionId: id,
      familiarId: "milo",
      harness: "claude",
      title: "Test chat",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      turns,
    }),
  );
}

function conversationPath(id: string) {
  return join(CONV_DIR, `${id}.json`);
}

function readState(): any {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function deleteReq(query = "") {
  return new Request(`http://test/api/chat/conversation/x${query}`, { method: "DELETE" });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

const { DELETE } = await import("./route.ts");
const { PUT, POST } = await import("./route.ts");

function writeReq(bodyObj: unknown) {
  return new Request("http://test/api/chat/conversation/x", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
}

test("DELETE ?ifEmpty=1 on an empty conversation deletes it and does NOT sacrifice", async () => {
  writeConversation("sess-empty", []);
  const res = await DELETE(deleteReq("?ifEmpty=1"), paramsFor("sess-empty"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true, deleted: true });
  assert.equal(existsSync(conversationPath("sess-empty")), false, "file removed");
  // The whole point of the fix: an ifEmpty delete must never sacrifice, or a
  // same-id conversation recreated moments later by chat/send would be
  // permanently hidden from every list (sessionSacrificed has no un-set path).
  const state = readState();
  assert.equal(state?.sessionSacrificed?.["sess-empty"], undefined, "not sacrificed");
});

test("DELETE ?ifEmpty=1 on a non-empty conversation leaves it alone", async () => {
  writeConversation("sess-full", [
    { id: "t1", role: "user", text: "hi", createdAt: "2026-06-01T00:00:00Z" },
  ]);
  const res = await DELETE(deleteReq("?ifEmpty=1"), paramsFor("sess-full"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true, deleted: false });
  assert.equal(existsSync(conversationPath("sess-full")), true, "file untouched");
  const state = readState();
  assert.equal(state?.sessionSacrificed?.["sess-full"], undefined, "not sacrificed");
});

test("DELETE ?ifEmpty=1 on a missing conversation reports not deleted", async () => {
  const res = await DELETE(deleteReq("?ifEmpty=1"), paramsFor("sess-missing"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true, deleted: false });
});

test("default DELETE (no ifEmpty) still deletes AND sacrifices, even with turns", async () => {
  writeFileSync(BOARD_PATH, JSON.stringify({
    version: 1,
    cards: [{
      id: "card-linked",
      title: "Linked task",
      notes: "",
      status: "running",
      lifecycle: "running",
      priority: "medium",
      familiarId: "milo",
      sessionId: "sess-default",
      cwd: null,
      projectId: null,
      links: [],
      github: [],
      asana: [],
      labels: [],
      steps: [],
      needsHuman: false,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    }],
  }));
  writeConversation("sess-default", [
    { id: "t1", role: "user", text: "hi", createdAt: "2026-06-01T00:00:00Z" },
  ]);
  const res = await DELETE(deleteReq(), paramsFor("sess-default"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.deleted, true);
  assert.equal(typeof json.sacrificedAt, "string");
  assert.equal(json.unlinkedCards, 1);
  assert.equal(existsSync(conversationPath("sess-default")), false, "file removed");
  const state = readState();
  assert.equal(typeof state.sessionSacrificed["sess-default"], "string", "sacrificed — other callers depend on this");
  const board = JSON.parse(readFileSync(BOARD_PATH, "utf8"));
  assert.equal(board.cards[0].sessionId, null, "deleted conversations cannot leave dangling task links");
});

// --- #3469: client PUT cannot forge harness telemetry onto assistant turns ---
test("PUT strips client-forged assistant telemetry (usage/cost/tools/reasoning)", async () => {
  const res = await PUT(
    writeReq({
      familiarId: "milo",
      harness: "claude",
      turns: [
        { role: "user", text: "hi" },
        {
          role: "assistant",
          text: "totally real answer",
          usage: { inputTokens: 999, outputTokens: 999 },
          costUsd: 42,
          tools: [{ id: "t", name: "shell", status: "ok" }],
          reasoning: "fake",
        },
      ],
    }),
    paramsFor("sess-forge"),
  );
  const json = await res.json();
  assert.equal(res.status, 200, "legitimate client write still succeeds");
  const asst = json.conversation.turns.find((t: any) => t.role === "assistant");
  assert.ok(asst, "assistant turn persisted");
  assert.equal(asst.text, "totally real answer", "text preserved");
  for (const f of ["usage", "costUsd", "tools", "reasoning"]) {
    assert.equal(f in asst, false, `harness-owned ${f} stripped from client write`);
  }
});

test("PUT rejects an over-long turn with 413", async () => {
  const res = await PUT(
    writeReq({
      familiarId: "milo",
      harness: "claude",
      turns: [{ role: "user", text: "z".repeat(200_001) }],
    }),
    paramsFor("sess-toolong"),
  );
  assert.equal(res.status, 413, "over-long turn text is rejected with 413");
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /too long/);
});
