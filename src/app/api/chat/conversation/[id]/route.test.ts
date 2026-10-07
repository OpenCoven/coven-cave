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
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
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

const { DELETE, GET, PATCH } = await import("./route.ts");
const { PUT, POST } = await import("./route.ts");

function writeReq(bodyObj: unknown) {
  return new Request("http://test/api/chat/conversation/x", {
    method: "PUT",
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

test("PUT cannot mint runtime identity evidence", async () => {
  const res = await PUT(writeReq({ familiarId: "milo", harness: "claude", turns: [{
    role: "assistant", text: "Imported answer", responseMetadata: {
      familiarId: "milo", harness: "claude", model: "anthropic/claude-opus-5-5", runtime: "local:/repos/cave",
      runtimeIdentity: { schemaVersion: 1, harness: "claude", version: "2.1.280", model: "claude-opus-5-5",
        activity: { schemaVersion: 1, path: "coven", tools: "supported", reasoning: "supported" } },
    },
  }] }), paramsFor("sess-forged-runtime-identity"));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.conversation.turns[0].responseMetadata?.runtimeIdentity, undefined);
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
      runtimeIdentity: { schemaVersion: 1, harness: "claude", version: "2.1.280", model: "claude-opus-5-5", payload: "private-provider-data",
        activity: { schemaVersion: 1, path: "coven", tools: "partial", reasoning: "disabled", payload: "private-provider-data" } },
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
  assert.deepEqual(json.conversation.turns[0].responseMetadata.runtimeIdentity, { schemaVersion: 1, harness: "claude", version: "2.1.280", model: "claude-opus-5-5",
    activity: { schemaVersion: 1, path: "coven", tools: "partial", reasoning: "disabled" } }, "reload retains only validated server-owned runtime facts");
});

// --- cave-wbxcu: createdAt is decided at creation and read-only afterwards ---
//
// `GET /api/client/v1/conversations` pages on createdAt descending, so the
// field is a keyset cursor's coordinate: a record whose createdAt moves moves
// under every open cursor, and if it moves UP the rest of that walk never
// serves it. This route was the only writer in Cave that could move one — it
// composed `body.createdAt || existing?.createdAt || now`, so a transcript
// older than the field was stamped with `now` on its next turn (wrong fact,
// and a silent skip), and any client body could rewrite a stored value.

function writeKeylessConversation(id: string, turns: unknown[] = []) {
  mkdirSync(CONV_DIR, { recursive: true });
  // No createdAt at all — the shape a transcript written before the field has.
  writeFileSync(
    join(CONV_DIR, `${id}.json`),
    JSON.stringify({
      sessionId: id,
      familiarId: "milo",
      harness: "claude",
      title: "Legacy chat",
      updatedAt: "2026-06-01T00:00:00Z",
      turns,
    }),
  );
}

function postReq(bodyObj: unknown) {
  return new Request("http://test/api/chat/conversation/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
}

function storedConversation(id: string) {
  return JSON.parse(readFileSync(conversationPath(id), "utf8"));
}

test("POST leaves a legacy record with no createdAt without one", async () => {
  writeKeylessConversation("sess-legacy-keyless-post", [
    { id: "t1", role: "user", text: "hi", createdAt: "2026-06-01T00:00:00Z" },
  ]);
  const res = await POST(
    postReq({ turn: { id: "t2", role: "user", text: "again", createdAt: "2026-06-02T00:00:00Z" } }),
    paramsFor("sess-legacy-keyless-post"),
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  // The turn landed — a record that refused the write would pass the createdAt
  // assertion for the wrong reason.
  assert.equal(json.conversation.turns.length, 2);
  assert.equal(
    "createdAt" in json.conversation,
    false,
    "the response must not invent a createdAt the store does not have",
  );
  const stored = storedConversation("sess-legacy-keyless-post");
  assert.equal(stored.turns.length, 2, "the turn was persisted, so the write really happened");
  assert.equal(
    "createdAt" in stored,
    false,
    "stamping `now` here moves the row from the tail of the client-v1 ordering to its head",
  );
});

test("PUT leaves a legacy record with no createdAt without one", async () => {
  writeKeylessConversation("sess-legacy-keyless-put", [
    { id: "t1", role: "user", text: "hi", createdAt: "2026-06-01T00:00:00Z" },
  ]);
  const res = await PUT(
    writeReq({
      turns: [{ id: "t9", role: "user", text: "replaced", createdAt: "2026-06-03T00:00:00Z" }],
    }),
    paramsFor("sess-legacy-keyless-put"),
  );
  assert.equal(res.status, 200);
  const stored = storedConversation("sess-legacy-keyless-put");
  assert.equal(stored.turns.length, 1);
  assert.equal(stored.turns[0].id, "t9", "the turns really were replaced");
  assert.equal("createdAt" in stored, false);
});

test("POST creating a conversation stamps createdAt, because that IS the creation", async () => {
  const res = await POST(
    postReq({
      familiarId: "milo",
      harness: "claude",
      turn: { id: "t1", role: "user", text: "new", createdAt: "2026-06-04T00:00:00Z" },
    }),
    paramsFor("sess-brand-new"),
  );
  assert.equal(res.status, 200);
  const stored = storedConversation("sess-brand-new");
  assert.equal(
    Number.isFinite(Date.parse(stored.createdAt)),
    true,
    "a record created now has been created now — this is the one write that may stamp",
  );
});

test("a body createdAt seeds a NEW conversation and cannot rewrite a stored one", async () => {
  // An import or an offline replay knows the real creation time better than the
  // clock does, so the body is honoured while there is no record to contradict
  // it...
  const created = await POST(
    postReq({
      familiarId: "milo",
      harness: "claude",
      createdAt: "2024-01-02T03:04:05.000Z",
      turn: { id: "t1", role: "user", text: "imported", createdAt: "2024-01-02T03:04:05.000Z" },
    }),
    paramsFor("sess-imported"),
  );
  assert.equal(created.status, 200);
  assert.equal(storedConversation("sess-imported").createdAt, "2024-01-02T03:04:05.000Z");

  // ...and refused afterwards. A stored createdAt is a cursor coordinate, and a
  // client that can rewrite it can move any row past any open walk.
  const rewritten = await PUT(
    writeReq({
      createdAt: "2036-12-31T00:00:00.000Z",
      turns: [{ id: "t2", role: "user", text: "again", createdAt: "2036-12-31T00:00:00.000Z" }],
    }),
    paramsFor("sess-imported"),
  );
  assert.equal(rewritten.status, 200);
  const stored = storedConversation("sess-imported");
  assert.equal(stored.turns[0].id, "t2", "the write landed, so the refusal below is not vacuous");
  assert.equal(stored.createdAt, "2024-01-02T03:04:05.000Z");

  // Nor can a body ADD one to a record that has none — the same rewrite, onto
  // the rows the empty-string sentinel exists to protect.
  writeKeylessConversation("sess-legacy-body-createdat", []);
  const forced = await PUT(
    writeReq({
      createdAt: "2036-12-31T00:00:00.000Z",
      turns: [{ id: "t1", role: "user", text: "hi", createdAt: "2026-06-01T00:00:00Z" }],
    }),
    paramsFor("sess-legacy-body-createdat"),
  );
  assert.equal(forced.status, 200);
  const legacy = storedConversation("sess-legacy-body-createdat");
  assert.equal(legacy.turns.length, 1, "the write landed");
  assert.equal("createdAt" in legacy, false);
});

// #5581: on-demand tool outputs for the web chat view.
test("GET with toolOutputs=recent omits older large outputs; the default GET keeps everything", async () => {
  const big = (label: string) => `${label} `.repeat(400);
  const tool = (id: string, output: string) => ({ id, name: "Bash", status: "ok", output });
  writeConversation("sess-lazy-tools", [
    { id: "t1", parentId: null, role: "assistant", text: "one", createdAt: "2026-06-01T00:00:01Z", tools: [tool("a", big("a"))] },
    { id: "t2", parentId: "t1", role: "assistant", text: "two", createdAt: "2026-06-01T00:00:02Z", tools: [tool("b", big("b")), tool("c", big("c")), tool("d", big("d"))] },
  ]);
  const slim = await (await GET(new Request("http://test/api/chat/conversation/sess-lazy-tools?toolOutputs=recent"), paramsFor("sess-lazy-tools"))).json();
  const slimTools = slim.conversation.turns.flatMap((turn) => turn.tools);
  assert.equal(slimTools[0].output, undefined, "an older large output is omitted");
  assert.equal(slimTools[0].outputChars, big("a").length);
  assert.deepEqual(slimTools.slice(1).map((t) => t.output), [big("b"), big("c"), big("d")], "the last three stay");

  const full = await (await GET(new Request("http://test/api/chat/conversation/sess-lazy-tools"), paramsFor("sess-lazy-tools"))).json();
  assert.equal(full.conversation.turns[0].tools[0].output, big("a"), "other readers keep the full payload");

  const { GET: TOOL_OUTPUT } = await import("./tool-output/route.ts");
  const found = await TOOL_OUTPUT(new Request("http://test/api/chat/conversation/sess-lazy-tools/tool-output?toolId=a"), paramsFor("sess-lazy-tools"));
  assert.equal(found.status, 200);
  assert.equal((await found.json()).output, big("a"), "the card fetches the full output");
  const missing = await TOOL_OUTPUT(new Request("http://test/api/chat/conversation/sess-lazy-tools/tool-output?toolId=zzz"), paramsFor("sess-lazy-tools"));
  assert.equal(missing.status, 404);
  const noTool = await TOOL_OUTPUT(new Request("http://test/api/chat/conversation/sess-lazy-tools/tool-output"), paramsFor("sess-lazy-tools"));
  assert.equal(noTool.status, 400);
  const badId = await TOOL_OUTPUT(new Request("http://test/api/chat/conversation/x/tool-output?toolId=a"), paramsFor("../escape"));
  assert.equal(badId.status, 400);
});

// #5607: reopening an unchanged chat is a bodiless 304.
test("GET is conditional: an unchanged transcript answers 304, any change a new tag", async () => {
  const id = "sess-etag";
  const url = `http://test/api/chat/conversation/${id}?toolOutputs=recent`;
  const get = (headers = {}, target = url) => GET(new Request(target, { headers }), paramsFor(id));
  writeConversation(id, [
    { id: "t1", parentId: null, role: "user", text: "hello", createdAt: "2026-06-01T00:00:01Z" },
  ]);
  const first = await get();
  assert.equal(first.status, 200);
  const tag = first.headers.get("etag");
  assert.match(tag, /^"c-[A-Za-z0-9_-]{32}"$/);
  assert.equal((await first.json()).conversation.turns.length, 1);

  const unchanged = await get({ "if-none-match": tag });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get("etag"), tag);
  assert.equal(await unchanged.text(), "", "a 304 carries no transcript");

  const full = await get({ "if-none-match": tag }, `http://test/api/chat/conversation/${id}`);
  assert.equal(full.status, 200, "the full flavor never matches the recent flavor's tag");
  assert.notEqual(full.headers.get("etag"), tag);

  writeConversation(id, [
    { id: "t1", parentId: null, role: "user", text: "hello", createdAt: "2026-06-01T00:00:01Z" },
    { id: "t2", parentId: "t1", role: "assistant", text: "hi", createdAt: "2026-06-01T00:00:02Z" },
  ]);
  const changed = await get({ "if-none-match": tag });
  assert.equal(changed.status, 200, "a changed transcript is a full response");
  const changedTag = changed.headers.get("etag");
  assert.notEqual(changedTag, tag);
  assert.equal((await changed.json()).conversation.turns.length, 2);

  // Linked context comes from the board, not the transcript file.
  writeFileSync(BOARD_PATH, JSON.stringify({
    version: 1,
    cards: [{
      id: "card-etag", title: "Etag task", notes: "", status: "running", lifecycle: "running",
      priority: "medium", familiarId: "milo", sessionId: id, cwd: null, projectId: null,
      links: [], github: [], asana: [], labels: [], steps: [], needsHuman: false,
      createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z",
    }],
  }));
  const linked = await get({ "if-none-match": changedTag });
  assert.equal(linked.status, 200, "a new board link invalidates the tag");
  assert.equal((await linked.json()).context?.task?.id, "card-etag");
});

// #5611: pasted images from before #5587 move to the attachment store on the
// first open instead of shipping inline on every one.
test("GET migrates inline images to the attachment store without touching updatedAt", async () => {
  const id = "sess-inline-images";
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  writeConversation(id, [
    {
      id: "t1", parentId: null, role: "user", text: "look", createdAt: "2026-06-01T00:00:01Z",
      attachments: [
        { name: "shot.png", type: "image/png", mimeType: "image/png", size: 68, dataUrl: png },
        { name: "notes.txt", type: "text/plain", size: 5, text: "hello" },
      ],
    },
    { id: "t2", parentId: "t1", role: "assistant", text: "seen", createdAt: "2026-06-01T00:00:02Z" },
  ]);
  const res = await GET(new Request(`http://test/api/chat/conversation/${id}?toolOutputs=recent`), paramsFor(id));
  assert.equal(res.status, 200);
  const served = (await res.json()).conversation.turns[0].attachments;
  assert.equal(served[0].dataUrl, undefined, "the image is no longer shipped inline");
  assert.match(served[0].storedId, /^[0-9a-f-]{36}\.png$/);
  assert.equal(served[1].text, "hello", "non-image attachments are untouched");

  const stored = storedConversation(id);
  assert.equal(stored.updatedAt, "2026-06-01T00:00:00Z", "a migration is not activity: the chat keeps its place");
  assert.equal(stored.turns[0].attachments[0].storedId, served[0].storedId, "the file itself was migrated");
  assert.equal(stored.turns[0].attachments[0].dataUrl, undefined);
  assert.equal(stored.turns.length, 2);

  const { readChatImageAttachment } = await import("@/lib/server/chat-attachment-store");
  const image = await readChatImageAttachment(served[0].storedId);
  assert.equal(`data:image/png;base64,${image.data.toString("base64")}`, png, "the stored bytes are the pasted image");

  const tag = res.headers.get("etag");
  const again = await GET(
    new Request(`http://test/api/chat/conversation/${id}?toolOutputs=recent`, { headers: { "if-none-match": tag } }),
    paramsFor(id),
  );
  assert.equal(again.status, 304, "the tag describes the migrated transcript that was served");
});

const LEGACY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
function writeLegacyImage(id, dataUrl = LEGACY_PNG) {
  writeConversation(id, [{
    id: "image-turn", role: "user", text: "look", createdAt: "2026-06-01T00:00:01Z",
    attachments: [{ name: "shot.png", mimeType: "image/png", dataUrl }],
  }]);
}
function getConversation(id, etag) {
  return GET(new Request(`http://test/api/chat/conversation/${id}`, {
    headers: etag ? { "if-none-match": etag } : {},
  }), paramsFor(id));
}

test("GET migrates valid mixed-case legacy image headers", async () => {
  const id = "sess-mixed-image";
  writeLegacyImage(id, LEGACY_PNG.replace("data:image/png", "data:IMAGE/PNG"));
  const res = await getConversation(id);
  const attachment = (await res.json()).conversation.turns[0].attachments[0];
  assert.match(attachment.storedId, /^[0-9a-f-]{36}\.png$/);
  assert.equal(attachment.dataUrl, undefined);
});

test("a conditional reopen retries migration after the attachment store recovers", async (t) => {
  const id = "sess-store-recovery";
  writeLegacyImage(id);
  const before = readFileSync(conversationPath(id), "utf8");
  const blockedStore = join(TMP, "blocked-attachments");
  writeFileSync(blockedStore, "not a directory");
  const previous = process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR;
  process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = blockedStore;
  t.after(() => {
    if (previous === undefined) delete process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR;
    else process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = previous;
  });
  const failed = await getConversation(id);
  assert.equal(failed.status, 200);
  assert.equal((await failed.json()).conversation.turns[0].attachments[0].dataUrl, LEGACY_PNG);
  assert.equal(readFileSync(conversationPath(id), "utf8"), before, "a refused store leaves the source byte-for-byte intact");
  const stillFailing = await getConversation(id, failed.headers.get("etag"));
  assert.equal(stillFailing.status, 304, "after retrying an unchanged failure, do not resend the inline payload");
  assert.equal(await stillFailing.text(), "");
  rmSync(blockedStore);
  mkdirSync(blockedStore);
  const recovered = await getConversation(id, failed.headers.get("etag"));
  assert.equal(recovered.status, 200, "the cached inline response must not prevent retry after recovery");
  const attachment = (await recovered.json()).conversation.turns[0].attachments[0];
  assert.ok(attachment.storedId);
  assert.equal(attachment.dataUrl, undefined);
  assert.notEqual(recovered.headers.get("etag"), failed.headers.get("etag"));
  const { getStoreReadCacheMetrics, resetStoreReadCacheMetrics } = await import("@/lib/server/store-read-cache");
  resetStoreReadCacheMetrics();
  const unchanged = await getConversation(id, recovered.headers.get("etag"));
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  const metrics = getStoreReadCacheMetrics();
  assert.equal(metrics.hits + metrics.misses, 0, "a known migrated revision keeps the clone-free 304 fast path");
});

test("a failed transcript replacement preserves inline data and retries on conditional reopen", async (t) => {
  const id = "sess-replace-recovery";
  writeLegacyImage(id);
  const { chatAttachmentRoot, saveChatImageAttachment } = await import("@/lib/server/chat-attachment-store");
  const existingId = await saveChatImageAttachment(LEGACY_PNG, "image/png");
  const original = storedConversation(id);
  original.turns[0].attachments.push({ name: "existing.png", storedId: existingId });
  original.turns[0].attachments.push({ name: "legacy.ico", dataUrl: LEGACY_PNG.replace("image/png", "image/x-icon") });
  writeFileSync(conversationPath(id), JSON.stringify(original));
  const before = readFileSync(conversationPath(id), "utf8");
  const filesBefore = readdirSync(chatAttachmentRoot()).sort();
  const rename = fsPromises.rename;
  const mocked = t.mock.method(fsPromises, "rename", async (source, target) => {
    if (target === conversationPath(id)) throw Object.assign(new Error("injected I/O failure"), { code: "EIO" });
    return rename(source, target);
  });
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  const failed = await getConversation(id);
  assert.equal(failed.status, 200);
  assert.equal((await failed.json()).conversation.turns[0].attachments[0].dataUrl, LEGACY_PNG);
  assert.equal(readFileSync(conversationPath(id), "utf8"), before);
  assert.deepEqual(readdirSync(chatAttachmentRoot()).sort(), filesBefore, "failed replacement removes only images created by this attempt");
  assert.ok(mocked.mock.calls.some(({ arguments: args }) => args[1] === conversationPath(id)), "the atomic replacement failure was exercised");
  const failedAgain = await getConversation(id, failed.headers.get("etag"));
  assert.equal(failedAgain.status, 304);
  assert.deepEqual(readdirSync(chatAttachmentRoot()).sort(), filesBefore, "repeated failures do not accumulate orphaned copies");
  mocked.mock.restore();
  syncBuiltinESMExports();
  const recovered = await getConversation(id, failed.headers.get("etag"));
  assert.equal(recovered.status, 200);
  assert.ok((await recovered.json()).conversation.turns[0].attachments[0].storedId);
});

test("migration serializes with other writes, is idempotent, and preserves refused images and legacy fields", async () => {
  const id = "sess-migration-concurrent";
  writeLegacyImage(id);
  const original = storedConversation(id);
  original.legacyExtension = { keep: true };
  original.turns[0].attachments.push({ name: "refused.png", dataUrl: "data:image/png;base64," });
  writeFileSync(conversationPath(id), JSON.stringify(original));
  const { migrateConversationInlineImages, withConversationLock } = await import("@/lib/cave-conversations");
  const { writeJsonAtomic } = await import("@/lib/server/atomic-write");
  let release;
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const held = withConversationLock(id, () => new Promise((resolve) => { release = resolve; entered(); }));
  await ready;
  const priorWriter = withConversationLock(id, async () => {
    const latest = storedConversation(id);
    latest.turns[0].text = "Edit queued before migration";
    await writeJsonAtomic(conversationPath(id), latest);
  });
  const first = migrateConversationInlineImages(id);
  const second = migrateConversationInlineImages(id);
  const writer = withConversationLock(id, async () => {
    const latest = storedConversation(id);
    latest.title = "Concurrent edit";
    latest.turns.push({ id: "new-turn", role: "assistant", text: "new reply" });
    await writeJsonAtomic(conversationPath(id), latest);
  });
  release();
  const [, , moved, repeated] = await Promise.all([held, priorWriter, first, second, writer]);
  assert.equal(moved, 1);
  assert.equal(repeated, 0);
  const result = storedConversation(id);
  assert.equal(result.title, "Concurrent edit");
  assert.equal(result.turns[0].text, "Edit queued before migration", "migration re-reads after acquiring the lock");
  assert.equal(result.turns[1].text, "new reply");
  assert.equal(result.updatedAt, original.updatedAt);
  assert.deepEqual(result.legacyExtension, original.legacyExtension);
  assert.equal(result.turns[0].parentId, undefined, "raw migration does not persist unrelated legacy normalization");
  assert.equal(result.turns[0].attachments[1].dataUrl, "data:image/png;base64,");
  const { readChatImageAttachment } = await import("@/lib/server/chat-attachment-store");
  const storedId = result.turns[0].attachments[0].storedId;
  assert.ok(await readChatImageAttachment(storedId));
  const before = readFileSync(conversationPath(id), "utf8");
  assert.equal(await migrateConversationInlineImages(id), 0);
  assert.equal(readFileSync(conversationPath(id), "utf8"), before);
});

test("concurrent first opens all serve the migrated image and its final tag", async () => {
  const id = "sess-concurrent-opens";
  writeLegacyImage(id);
  const responses = await Promise.all(Array.from({ length: 8 }, () => getConversation(id)));
  const stored = storedConversation(id).turns[0].attachments[0];
  assert.ok(stored.storedId);
  for (const response of responses) {
    assert.equal(response.status, 200);
    const attachment = (await response.json()).conversation.turns[0].attachments[0];
    assert.equal(attachment.storedId, stored.storedId);
    assert.equal(attachment.dataUrl, undefined);
    assert.equal((await getConversation(id, response.headers.get("etag"))).status, 304);
  }
});


test("tool provenance survives history only with a matching server-owned call and cannot be client-authored", async () => {
  const activity = {
    schemaVersion: 1, runId: "22222222-3333-4444-8555-666666666666",
    attemptId: "33333333-3333-4444-8555-666666666666", callId: "read-1", phase: "ok",
    source: "runtime-report", producer: { harness: "hermes", version: null, protocol: "hermes-responses-v1" },
    firstObservedAt: 100, updatedAt: 150, executionObservedAt: 110, terminalObservedAt: 150,
    authority: { binding: "unavailable", approval: "unavailable", effect: "unavailable" },
  };
  const tool = { id: "read-1", name: "Read", status: "ok", activity };
  const turn = { id: "a", role: "assistant", text: "Done", createdAt: "2026-10-03T00:00:00Z", tools: [tool] };
  const id = "sess-tool-provenance";
  writeConversation(id, [turn, { ...turn, id: "b", tools: [{ ...tool, activity: { ...activity, callId: "other" } }] },
    { ...turn, id: "c", role: "user" }]);
  const history = await (await GET(new Request(`http://test/api/chat/conversation/${id}`), paramsFor(id))).json();
  assert.deepEqual(history.conversation.turns[0].tools[0].activity, activity);
  assert.equal(history.conversation.turns[1].tools[0].activity, undefined);
  assert.equal(history.conversation.turns[2].tools, undefined, "user turns cannot expose server telemetry");
  const write = await PUT(writeReq({ turns: [turn] }), paramsFor(id));
  assert.equal(write.status, 200);
  assert.equal(storedConversation(id).turns[0].tools, undefined, "client writes cannot mint even well-shaped observations");
});

test("typed reasoning history remains server-owned and future blocks cannot hide the answer", async () => {
  const { ReasoningBlockTracker } = await import("@/lib/server/chat-reasoning-projection");
  const tracker = new ReasoningBlockTracker(() => ({
    runId: "11111111-2222-4333-8444-555555555555", harness: "codex", version: "0.145.0", protocol: "codex-jsonl-v1",
  }), "22222222-2222-4333-8444-555555555555", () => 100);
  const block = tracker.observe("summary", "complete", "Compare the results.");
  const turn = { id: "a", role: "assistant", text: "Answer", createdAt: "2026-10-03T00:00:00Z", reasoningBlocks: [block] };
  const id = "sess-reasoning-projection";
  writeConversation(id, [turn, { ...turn, id: "b", reasoningBlocks: [{ ...block, schemaVersion: 99 }] }]);
  const history = await (await GET(new Request(`http://test/api/chat/conversation/${id}`), paramsFor(id))).json();
  assert.deepEqual(history.conversation.turns[0].reasoningBlocks, [block]);
  assert.equal(history.conversation.turns[1].reasoningBlocks, undefined);
  assert.equal(history.conversation.turns[1].text, "Answer");
  const response = await PUT(writeReq({ turns: [turn] }), paramsFor(id));
  assert.equal(response.status, 200);
  assert.equal(storedConversation(id).turns[0].reasoningBlocks, undefined);
});

test("history and lazy outputs share disclosure without rewriting stored execution records", async () => {
  const id = "sess-historical-disclosure";
  const nativeId = "call token=PRIVATE_NATIVE_ID";
  const signed = "https://files.example.com/report?sig=PRIVATE_URL";
  const tool = { id: nativeId, name: "Lookup person@example.com", status: "ok", input: `email person@example.com ${signed}`,
    output: `Result password=PRIVATE_OUTPUT ${signed}`, _meta: "OPAQUE_TOOL_STATE" };
  const answer = "Answer with a code example: `<thinking>literal</thinking>`.";
  writeConversation(id, [{ id: "a", role: "assistant", text: `<thinking>PRIVATE_LEGACY_TAG</thinking>${answer}`, createdAt: "2026-10-03T00:00:00Z",
    reasoning: "UNCLASSIFIED_REASONING", tools: [tool, { ...tool, id: "unfinished", status: "running", output: "INCOMPLETE_PAYLOAD" }, null],
    progress: [{ id: nativeId, label: "Contact person@example.com", detail: signed, status: "notice", createdAt: "2026-10-03T00:00:00Z", _meta: "OPAQUE_PROGRESS" }] }]);
  const before = readFileSync(conversationPath(id), "utf8");
  const response = await GET(new Request(`http://test/api/chat/conversation/${id}`), paramsFor(id));
  const body = await response.json();
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|person@example|OPAQUE_|UNCLASSIFIED_REASONING|INCOMPLETE_PAYLOAD/);
  const turn = body.conversation.turns[0];
  assert.equal(turn.text, answer, "ordinary answers and code examples remain intact");
  assert.equal(turn.tools[0].status, "ok");
  assert.equal(turn.tools[0].activity, undefined, "legacy tools gain no invented provenance");
  assert.equal(turn.tools[1].status, "running");
  assert.equal(turn.tools[1].output, undefined, "unfinished legacy previews have no complete-unit contract");
  const { GET: TOOL_OUTPUT } = await import("./tool-output/route.ts");
  const lazy = await TOOL_OUTPUT(new Request(`http://test/api/chat/conversation/${id}/tool-output?toolId=${turn.tools[0].id}`), paramsFor(id));
  assert.equal(lazy.status, 200);
  assert.deepEqual(await lazy.json(), { ok: true, output: turn.tools[0].output });
  assert.equal(readFileSync(conversationPath(id), "utf8"), before, "read projection never migrates private execution records");

  // Comparing redacted values would incorrectly resolve these conflicting calls.
  const duplicateId = "sess-private-ambiguous";
  writeConversation(duplicateId, [{ id: "a", role: "assistant", text: "Answer", createdAt: "2026-10-03T00:00:00Z",
    tools: [{ ...tool, id: "duplicate", output: "password=FIRST_VALUE" }, { ...tool, id: "duplicate", output: "password=SECOND_VALUE" }] }]);
  const ambiguous = await TOOL_OUTPUT(new Request(`http://test/api/chat/conversation/${duplicateId}/tool-output?toolId=duplicate`), paramsFor(duplicateId));
  assert.equal(ambiguous.status, 409, "redaction must not erase raw-output ambiguity");
});

test("history projection is idempotent and preserves ambiguity in the stored hash namespace", async () => {
  const { projectConversationDisplay, findDisplayToolOutput } = await import("@/lib/server/conversation-display-projection");
  const { ToolCallTracker, toPersistedTools } = await import("@/lib/chat-tool-events");
  const tracker = new ToolCallTracker(() => 100, "", {
    runId: "11111111-2222-4333-8444-555555555555", harness: "codex", version: "0.145.0", protocol: "codex-jsonl-v1",
  });
  const nativeId = "call token=PRIVATE_HASH_ID";
  tracker.envelopeToolUse(nativeId, "Read", "safe.ts");
  tracker.envelopeToolResult(nativeId, "Safe output", false);
  const tools = toPersistedTools(tracker.snapshot(), 0);
  const id = "sess-hash-projection";
  writeConversation(id, [{ id: "a", role: "assistant", text: "Answer", createdAt: "2026-10-03T00:00:00Z", tools }]);
  const original = storedConversation(id);
  const once = projectConversationDisplay(original);
  assert.deepEqual(projectConversationDisplay(once), once);
  assert.deepEqual(once.turns[0].tools, tools, "safe current IDs, provenance and payloads survive reload unchanged");
  assert.deepEqual(findDisplayToolOutput(original, tools[0].id), { kind: "found", output: "Safe output" });
  original.turns[0].tools.push({ id: nativeId, name: "Read", status: "ok", output: "Safe output" });
  assert.equal(findDisplayToolOutput(original, tools[0].id).kind, "ambiguous", "different stored IDs cannot silently merge even with equal outputs");
});
