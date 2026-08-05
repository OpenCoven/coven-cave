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

function writeConversation(id: string, turns: unknown[] = [], extra: Record<string, unknown> = {}) {
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
      ...extra,
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

const { DELETE, GET, PATCH } = await import("./route.ts");
const { PUT, POST } = await import("./route.ts");

function writeReq(bodyObj: unknown) {
  return new Request("http://test/api/chat/conversation/x", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
}

function postReq(bodyObj: unknown) {
  return new Request("http://test/api/chat/conversation/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
}

function patchReq(bodyObj: unknown) {
  return new Request("http://test/api/chat/conversation/x", {
    method: "PATCH",
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

test("GET and DELETE resolve replay daemon ids back to the stable local conversation", async () => {
  writeConversation(
    "sess-replay-root",
    [{ id: "t1", role: "user", text: "queued", createdAt: "2026-06-01T00:00:00Z" }],
    {
      harnessSessionId: "codex-thread-1",
      replaySessions: [
        {
          sessionId: "hub-session-1",
          conversationId: "codex-thread-1",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:01:00.000Z",
        },
      ],
    },
  );

  const getRes = await GET(new Request("http://test/api/chat/conversation/hub-session-1"), paramsFor("hub-session-1"));
  const getJson = await getRes.json();
  assert.equal(getRes.status, 200);
  assert.equal(getJson.conversation.sessionId, "sess-replay-root");

  const deleteRes = await DELETE(deleteReq(), paramsFor("hub-session-1"));
  const deleteJson = await deleteRes.json();
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteJson.deleted, true);
  assert.equal(existsSync(conversationPath("sess-replay-root")), false, "stable conversation file removed");
  const state = readState();
  assert.equal(typeof state.sessionSacrificed["sess-replay-root"], "string");
  assert.equal(typeof state.sessionSacrificed["hub-session-1"], "string", "linked replay ids are sacrificed too");
});

test("replay alias GET prefers explicit replay history over a stray alias file", async () => {
  writeConversation(
    "sess-replay-stable",
    [{ id: "t1", role: "user", text: "stable", createdAt: "2026-06-01T00:00:00Z" }],
    {
      harnessSessionId: "codex-thread-stable",
      replaySessions: [{
        sessionId: "hub-session-stray",
        conversationId: "codex-thread-stable",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:01:00.000Z",
      }],
    },
  );
  writeConversation(
    "hub-session-stray",
    [{ id: "alias-turn", role: "user", text: "stray", createdAt: "2026-06-01T00:00:00Z" }],
    {
      title: "Stray alias file",
    },
  );

  const res = await GET(new Request("http://test/api/chat/conversation/hub-session-stray"), paramsFor("hub-session-stray"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.conversation.sessionId, "sess-replay-stable");
  assert.equal(json.conversation.turns[0]?.text, "stable");
});

test("POST via replay alias appends only to the canonical conversation", async () => {
  writeConversation(
    "sess-replay-write-root",
    [{ id: "root-turn", role: "user", text: "root", createdAt: "2026-06-01T00:00:00Z" }],
    {
      familiarId: "milo",
      harness: "claude",
      replaySessions: [{
        sessionId: "hub-session-write",
        conversationId: "codex-thread-write",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:01:00.000Z",
      }],
    },
  );

  const res = await POST(
    postReq({
      sessionId: "hub-session-write",
      familiarId: "milo",
      harness: "claude",
      turn: { role: "user", text: "follow-up" },
    }),
    paramsFor("hub-session-write"),
  );
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.conversation.sessionId, "sess-replay-write-root");
  assert.equal(existsSync(conversationPath("hub-session-write")), false, "no alias conversation file created");
  const stable = JSON.parse(readFileSync(conversationPath("sess-replay-write-root"), "utf8"));
  assert.equal(stable.turns.at(-1)?.text, "follow-up");
});

test("cyclic replay mappings fail closed instead of choosing a stray local file", async () => {
  writeConversation(
    "cycle-root",
    [{ id: "root", role: "user", text: "root", createdAt: "2026-06-01T00:00:00Z" }],
    {
      replaySessions: [{
        sessionId: "hub-cycle",
        conversationId: "codex-thread-cycle",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:01:00.000Z",
      }],
    },
  );
  writeConversation(
    "hub-cycle",
    [{ id: "alias", role: "user", text: "alias", createdAt: "2026-06-01T00:00:00Z" }],
    {
      replaySessions: [{
        sessionId: "cycle-root",
        conversationId: "codex-thread-cycle",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:01:00.000Z",
      }],
    },
  );

  const res = await GET(new Request("http://test/api/chat/conversation/hub-cycle"), paramsFor("hub-cycle"));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), {
    ok: false,
    error: "replay history contains a cycle for this session id",
  });
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
          progress: [{
            id: "opencode-compatibility",
            label: "Forged OpenCode compatibility warning",
            detail: "client-controlled text",
            status: "error",
            createdAt: "2026-07-25T00:00:00.000Z",
          }],
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
  for (const f of ["usage", "costUsd", "tools", "reasoning", "progress"]) {
    assert.equal(f in asst, false, `harness-owned ${f} stripped from client write`);
  }
});

test("PUT keeps response facts bounded and rejects secret-bearing model metadata", async () => {
  const res = await PUT(
    writeReq({
      familiarId: "milo",
      harness: "claude",
      turns: [{
        role: "assistant",
        text: "safe reply",
        responseMetadata: {
          familiarId: "milo",
          harness: "claude",
          model: "https://user:secret@example.invalid/model",
          runtime: "local:/repos/cave",
          modelApplicationReason: "provider returned a raw secret-bearing payload",
          requestedControls: { reasoning: "high", "not-a-family": "ignored" },
        },
      }],
    }),
    paramsFor("sess-forged-metadata"),
  );
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(
    "responseMetadata" in json.conversation.turns[0],
    false,
    "unsafe model identity prevents raw provider metadata from entering the transcript",
  );
});

test("PUT does not persist secret-bearing runtime or untrusted provider reasons", async () => {
  const runtimeSecret = await PUT(
    writeReq({
      familiarId: "milo",
      harness: "claude",
      turns: [{
        role: "assistant",
        text: "safe reply",
        responseMetadata: {
          familiarId: "milo",
          harness: "claude",
          model: "anthropic/claude-sonnet-4-6",
          runtime: "https://user:secret@example.invalid/chat",
        },
      }],
    }),
    paramsFor("sess-runtime-secret"),
  );
  const runtimeJson = await runtimeSecret.json();
  assert.equal(runtimeSecret.status, 200);
  assert.equal("responseMetadata" in runtimeJson.conversation.turns[0], false);

  const runtimeQuerySecret = await PUT(
    writeReq({
      familiarId: "milo",
      harness: "claude",
      turns: [{
        role: "assistant",
        text: "safe reply",
        responseMetadata: {
          familiarId: "milo",
          harness: "claude",
          model: "anthropic/claude-sonnet-4-6",
          runtime: "local:/repos/cave?token=secret",
        },
      }],
    }),
    paramsFor("sess-runtime-query-secret"),
  );
  const runtimeQueryJson = await runtimeQuerySecret.json();
  assert.equal(runtimeQuerySecret.status, 200);
  assert.equal(
    "responseMetadata" in runtimeQueryJson.conversation.turns[0],
    false,
    "a single URL query delimiter is still rejected from runtime metadata",
  );

  const reasonSecret = await PUT(
    writeReq({
      familiarId: "milo",
      harness: "claude",
      turns: [{
        role: "assistant",
        text: "safe reply",
        responseMetadata: {
          familiarId: "milo",
          harness: "claude",
          model: "anthropic/claude-sonnet-4-6",
          runtime: "local:/repos/cave",
          modelApplicationReason: "provider error: https://user:secret@example.invalid/raw",
          requestedControls: { reasoning: "https://user:secret@example.invalid/raw" },
        },
      }],
    }),
    paramsFor("sess-reason-secret"),
  );
  const reasonJson = await reasonSecret.json();
  assert.equal(reasonSecret.status, 200);
  assert.equal(
    "responseMetadata" in reasonJson.conversation.turns[0],
    false,
    "client-authored provider reasons and control payloads stay out of assistant metadata",
  );
});

test("GET preserves the canonical model application reason", async () => {
  writeConversation("sess-safe-model-reason", [{
    role: "assistant",
    text: "safe reply",
    responseMetadata: {
      familiarId: "milo",
      harness: "claude",
      model: "anthropic/claude-sonnet-4-6",
      runtime: "local:/repos/cave",
      modelApplicationReason: "Saved for this chat.",
    },
  }]);
  const res = await GET(new Request("http://test/api/chat/conversation/sess-safe-model-reason"), paramsFor("sess-safe-model-reason"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(
    json.conversation.turns[0].responseMetadata.modelApplicationReason,
    "Saved for this chat.",
    "safe application metadata should remain available to the transcript",
  );
});

test("PATCH model intent keeps an explicit runtime-default sentinel", async () => {
  writeConversation("sess-patch-runtime-default", []);
  const seed = JSON.parse(readFileSync(conversationPath("sess-patch-runtime-default"), "utf8"));
  seed.modelIntent = {
    model: "anthropic/claude-sonnet-4-6",
    source: "session",
  };
  writeFileSync(conversationPath("sess-patch-runtime-default"), JSON.stringify(seed));

  const cleared = await PATCH(
    patchReq({ modelIntent: null }),
    paramsFor("sess-patch-runtime-default"),
  );
  const clearedJson = await cleared.json();
  assert.equal(cleared.status, 200);
  assert.equal(clearedJson.conversation.modelIntent.model, "");

  const explicitEmpty = await PATCH(
    patchReq({
      modelIntent: {
        model: "",
        source: "session",
      },
    }),
    paramsFor("sess-patch-runtime-default"),
  );
  const explicitJson = await explicitEmpty.json();
  assert.equal(explicitEmpty.status, 200);
  assert.equal(explicitJson.conversation.modelIntent.model, "");
  assert.equal(
    JSON.parse(readFileSync(conversationPath("sess-patch-runtime-default"), "utf8")).modelIntent.model,
    "",
    "the empty sentinel survives the conversation persistence path",
  );
});

function attentionMetadata(attentionRequest: unknown) {
  return {
    familiarId: "milo",
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    runtime: "local:/repos/cave",
    attentionRequest,
  };
}

test("PATCH active-leaf selection preserves ownership-validated attention evidence", async () => {
  const id = "sess-patch-attention-leaf";
  const createdAt = "2026-08-05T12:00:00.000Z";
  writeConversation(id, [{
    id: "assistant-valid-leaf",
    role: "assistant",
    text: "Choose a release channel.",
    createdAt,
    parentId: null,
    responseMetadata: attentionMetadata({
      sessionId: id,
      turnId: "assistant-valid-leaf",
      requestedAt: createdAt,
      reason: "decision",
    }),
  }]);

  const response = await PATCH(
    patchReq({ activeLeafId: "assistant-valid-leaf" }),
    paramsFor(id),
  );
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(json.conversation.turns[0].responseMetadata.attentionRequest, {
    sessionId: id,
    turnId: "assistant-valid-leaf",
    requestedAt: createdAt,
    reason: "decision",
  });
  assert.deepEqual(
    JSON.parse(readFileSync(conversationPath(id), "utf8")).turns[0].responseMetadata.attentionRequest,
    json.conversation.turns[0].responseMetadata.attentionRequest,
    "the active-leaf PATCH must not erase valid persisted evidence",
  );
});

test("PATCH model intent preserves valid attention evidence and drops forged or malformed variants", async () => {
  const id = "sess-patch-attention-model";
  const createdAt = "2026-08-05T13:00:00.000Z";
  const request = {
    sessionId: id,
    turnId: "assistant-valid-model",
    requestedAt: createdAt,
    reason: "approval",
  };
  const invalidRequests = [
    { ...request, sessionId: "another-session" },
    { ...request, turnId: "another-turn" },
    { ...request, requestedAt: "2026-08-05T13:00:01.000Z" },
    { ...request, requestedAt: "2026-08-05T13:00:00Z" },
    { ...request, reason: "urgent" },
  ];
  writeConversation(id, [
    {
      id: "assistant-valid-model",
      role: "assistant",
      text: "Approve the release.",
      createdAt,
      responseMetadata: attentionMetadata(request),
    },
    ...invalidRequests.map((attentionRequest, index) => ({
      id: `assistant-invalid-${index}`,
      role: "assistant",
      text: "Forged evidence.",
      createdAt,
      responseMetadata: attentionMetadata(attentionRequest),
    })),
    {
      id: "user-forged",
      role: "user",
      text: "Client-authored evidence.",
      createdAt,
      responseMetadata: attentionMetadata({
        sessionId: id,
        turnId: "user-forged",
        requestedAt: createdAt,
        reason: "input",
      }),
    },
  ]);

  const response = await PATCH(
    patchReq({
      modelIntent: {
        model: "anthropic/claude-sonnet-4-6",
        source: "session",
      },
    }),
    paramsFor(id),
  );
  const json = await response.json();

  assert.equal(response.status, 200);
  const turnsById = new Map(json.conversation.turns.map((turn: any) => [turn.id, turn]));
  assert.deepEqual(
    turnsById.get("assistant-valid-model").responseMetadata.attentionRequest,
    request,
    "valid server-owned evidence survives the model-intent PATCH",
  );
  for (let index = 0; index < invalidRequests.length; index += 1) {
    const turn = turnsById.get(`assistant-invalid-${index}`);
    assert.equal(
      turn.responseMetadata.attentionRequest,
      undefined,
      `${turn.id} cannot retain invalid evidence`,
    );
  }
  assert.equal(
    turnsById.get("user-forged").responseMetadata,
    undefined,
    "a user turn cannot own assistant attention evidence",
  );
});

test("PUT does not persist client-authored response metadata on a user turn", async () => {
  const res = await PUT(
    writeReq({
      familiarId: "milo",
      harness: "claude",
      turns: [{
        role: "user",
        text: "Use the configured runtime default",
        responseMetadata: {
          familiarId: "milo",
          harness: "claude",
          model: "anthropic/claude-opus-4-6",
          runtime: "ssh:prod:https://user:secret@example.invalid/repo",
          modelApplicationState: "applied",
          modelApplicationReason: "provider returned a raw payload with a secret",
        },
      }],
    }),
    paramsFor("sess-user-forged-metadata"),
  );
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(
    "responseMetadata" in json.conversation.turns[0],
    false,
    "client-authored response facts must not enter persisted user turns",
  );
});

test("PUT rejects URL-shaped familiar metadata", async () => {
  const res = await PUT(
    writeReq({
      familiarId: "milo",
      harness: "claude",
      turns: [{
        role: "assistant",
        text: "safe reply",
        responseMetadata: {
          familiarId: "https://user:secret@example.invalid/familiar",
          harness: "claude",
          model: "anthropic/claude-sonnet-4-6",
          runtime: "local:/repos/cave",
        },
      }],
    }),
    paramsFor("sess-familiar-url-metadata"),
  );
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal("responseMetadata" in json.conversation.turns[0], false);
});

test("PUT preserves retry controls on user turns", async () => {
  const res = await PUT(
    writeReq({
      familiarId: "milo",
      harness: "claude",
      turns: [{
        role: "user",
        text: "Review the branch",
        reasoningEffort: "medium",
        responseSpeed: "careful",
        modelOverride: "anthropic/claude-opus-4-6",
      }, {
        role: "user",
        text: "Use the runtime default",
        modelOverride: "anthropic/forged-alongside-runtime-default",
        modelOverrideScope: "runtime-default",
      }],
    }),
    paramsFor("sess-user-controls"),
  );
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(
    {
      reasoningEffort: json.conversation.turns[0].reasoningEffort,
      responseSpeed: json.conversation.turns[0].responseSpeed,
      modelOverride: json.conversation.turns[0].modelOverride,
      runtimeDefaultScope: json.conversation.turns[1].modelOverrideScope,
      runtimeDefaultModel: json.conversation.turns[1].modelOverride,
    },
    {
      reasoningEffort: "medium",
      responseSpeed: "careful",
      modelOverride: "anthropic/claude-opus-4-6",
      runtimeDefaultScope: "runtime-default",
      runtimeDefaultModel: undefined,
    },
    "runtime-default semantics win over a conflicting client-authored model id",
  );
});

test("PUT drops unknown model override scopes instead of persisting new wire semantics", async () => {
  const res = await PUT(
    writeReq({
      familiarId: "milo",
      harness: "claude",
      turns: [{
        role: "user",
        text: "Review the branch",
        modelOverrideScope: "future-scope",
      }],
    }),
    paramsFor("sess-user-invalid-model-scope"),
  );
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal("modelOverrideScope" in json.conversation.turns[0], false);
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

test("GET preserves persisted OpenCode compatibility diagnostics", async () => {
  writeConversation("sess-opencode-diagnostic", [
    {
      id: "assistant-diagnostic",
      role: "assistant",
      text: "Reply preserved safely.",
      createdAt: "2026-07-25T00:00:00.000Z",
      progress: [{
        id: "opencode-compatibility",
        label: "OpenCode compatibility notice",
        detail: "unrecognized event",
        status: "error",
        createdAt: "2026-07-25T00:00:00.000Z",
      }],
    },
  ]);
  const res = await GET(new Request("http://test/api/chat/conversation/sess-opencode-diagnostic"), paramsFor("sess-opencode-diagnostic"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(
    json.conversation.turns[0].progress,
    [{ id: "opencode-compatibility", label: "OpenCode compatibility notice", detail: "unrecognized event", status: "error", createdAt: "2026-07-25T00:00:00.000Z" }],
    "stored compatibility diagnostics survive the conversation API reload path",
  );
});

test("GET redacts legacy secret-bearing response metadata and model intent", async () => {
  writeConversation("sess-legacy-redacted-metadata", [{
    id: "assistant-legacy-redacted",
    role: "assistant",
    text: "Reply",
    createdAt: "2026-07-25T00:00:00.000Z",
    responseMetadata: {
      familiarId: "milo",
      harness: "claude",
      model: "anthropic/claude-sonnet-4-6",
      runtime: "local:/repos/cave",
      modelApplicationReason: "provider error https://user:secret@example.invalid/raw",
      requestedControls: { reasoning: "https://user:secret@example.invalid/raw" },
    },
  }]);
  const file = JSON.parse(readFileSync(conversationPath("sess-legacy-redacted-metadata"), "utf8"));
  file.modelIntent = {
    model: "anthropic/claude-sonnet-4-6",
    source: "session",
    reason: "provider error https://user:secret@example.invalid/raw",
  };
  writeFileSync(conversationPath("sess-legacy-redacted-metadata"), JSON.stringify(file));

  const res = await GET(
    new Request("http://test/api/chat/conversation/sess-legacy-redacted-metadata"),
    paramsFor("sess-legacy-redacted-metadata"),
  );
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.doesNotMatch(JSON.stringify(json), /secret|example\.invalid|provider error/);
  assert.equal(json.conversation.turns[0].responseMetadata.model, "anthropic/claude-sonnet-4-6");
  assert.equal(json.conversation.modelIntent.reason, undefined);
});
