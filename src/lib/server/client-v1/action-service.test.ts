// @ts-nocheck
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createClientActionService, parseAttentionResponseInput, parseGitHubActionExecutionInput, parseTaskHandoffInput } from "./action-service.ts";
import { GitHubEffectStoreCapacityError } from "./github-effect-store.ts";
import { MAX_RESPONSE_BODY_BYTES } from "./idempotency-store.ts";

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function authorizeConversation(conversation) {
  return async (sessionId, effect) => {
    if (sessionId !== conversation.sessionId) {
      return {
        ok: false,
        status: 404,
        code: "not_found",
        message: "Conversation not found.",
        retryable: false,
      };
    }
    return { ok: true, value: await effect(conversation) };
  };
}

function lockingAuthorizeConversation(conversation) {
  let tail = Promise.resolve();
  return async (sessionId, effect) => {
    const previous = tail;
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    tail = previous.catch(() => undefined).then(() => current);
    await previous.catch(() => undefined);
    try {
      if (sessionId !== conversation.sessionId) {
        return {
          ok: false,
          status: 404,
          code: "not_found",
          message: "Conversation not found.",
          retryable: false,
        };
      }
      return { ok: true, value: await effect(conversation) };
    } finally {
      release();
    }
  };
}

function createEffectStoreDouble() {
  const records = new Map();
  function mintClaim(previous = null) {
    return {
      generation: (previous?.generation ?? 0) + 1,
      token: crypto.randomUUID(),
    };
  }
  function claimMatches(record, expected) {
    return record?.state === expected?.state
      && record?.claim
      && record.claim.generation === expected.claim.generation
      && record.claim.token === expected.claim.token;
  }
  return {
    beginGitHubEffect: async ({ effectId, source, action }) => {
      const existing = records.get(effectId);
      if (!existing) {
        const claim = mintClaim();
        const record = {
          effectId,
          state: "pending",
          source,
          action,
          claim,
          createdAt: "2026-08-10T10:02:00.000Z",
          updatedAt: "2026-08-10T10:02:00.000Z",
          pendingSince: "2026-08-10T10:02:00.000Z",
          receipt: null,
          lastFailure: null,
          attempts: [{ at: "2026-08-10T10:02:00.000Z", outcome: "started", reason: null, status: null }],
        };
        records.set(effectId, record);
        return { kind: "dispatch", record: structuredClone(record), claim: structuredClone(claim) };
      }
      if (existing.state === "succeeded") {
        return { kind: "replay", record: structuredClone(existing), receipt: structuredClone(existing.receipt) };
      }
      if (existing.state === "manual_reconciliation") {
        return {
          kind: "manual_reconciliation",
          record: structuredClone(existing),
          failure: structuredClone(existing.lastFailure),
        };
      }
      if (existing.state === "retryable_failure") {
        existing.claim = mintClaim();
        existing.state = "pending";
        existing.pendingSince = "2026-08-10T10:03:00.000Z";
        existing.updatedAt = existing.pendingSince;
        existing.lastFailure = null;
        existing.receipt = null;
        existing.attempts = [...existing.attempts, { at: existing.pendingSince, outcome: "started", reason: null, status: null }];
        return { kind: "dispatch", record: structuredClone(existing), claim: structuredClone(existing.claim) };
      }
      existing.claim = mintClaim(existing.claim);
      existing.updatedAt = "2026-08-10T10:03:00.000Z";
      existing.attempts = [...existing.attempts, { at: existing.updatedAt, outcome: "started", reason: null, status: null }];
      return { kind: "reconcile", record: structuredClone(existing), claim: structuredClone(existing.claim) };
    },
    settleGitHubEffectSuccess: async ({ effectId, receipt, expected }) => {
      const record = records.get(effectId);
      if (!claimMatches(record, expected)) return false;
      record.state = "succeeded";
      record.claim = null;
      record.pendingSince = null;
      record.receipt = structuredClone(receipt);
      record.lastFailure = null;
      return true;
    },
    settleGitHubEffectRetryableFailure: async ({ effectId, failure, expected }) => {
      const record = records.get(effectId);
      if (!claimMatches(record, expected)) return false;
      record.state = "retryable_failure";
      record.claim = null;
      record.pendingSince = null;
      record.lastFailure = structuredClone(failure);
      record.receipt = null;
      return true;
    },
    settleGitHubEffectManualReconciliation: async ({ effectId, failure, expected }) => {
      const record = records.get(effectId);
      if (!claimMatches(record, expected)) return false;
      record.state = "manual_reconciliation";
      record.claim = null;
      record.pendingSince = null;
      record.lastFailure = structuredClone(failure);
      record.receipt = null;
      return true;
    },
    read(effectId) {
      return structuredClone(records.get(effectId) ?? null);
    },
  };
}

test("strict parsers accept the supported DTO shapes and reject tampered ones", () => {
  assert.deepEqual(parseAttentionResponseInput({ conversationId: "conv-1", prompt: "  Sounds good  " }), {
    conversationId: "conv-1",
    prompt: "Sounds good",
  });
  assert.throws(() => parseAttentionResponseInput({ conversationId: "conv-1", prompt: "", extra: true }));

  assert.deepEqual(parseTaskHandoffInput({
    conversationId: "conv-1",
    turnId: "turn-7",
    prompt: "  Create the follow-up task  ",
    title: "  Ship the fix  ",
  }), {
    conversationId: "conv-1",
    turnId: "turn-7",
    prompt: "Create the follow-up task",
    title: "Ship the fix",
  });
  assert.throws(() => parseTaskHandoffInput({ conversationId: "conv-1", turnId: "turn-7", prompt: "x", unknown: true }));

  assert.deepEqual(parseGitHubActionExecutionInput({
    conversationId: "conv-1",
    turnId: "turn-9",
    confirmed: true,
    action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "  Ship it  " },
  }), {
    conversationId: "conv-1",
    turnId: "turn-9",
    confirmed: true,
    action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" },
  });
  assert.deepEqual(parseGitHubActionExecutionInput({
    conversationId: "conv-1",
    turnId: "turn-9",
    confirmed: true,
    action: { kind: "review", repo: "OpenCoven/coven-cave", number: 7, event: "REQUEST_CHANGES", body: "Needs tests" },
  }).action.event, "REQUEST_CHANGES");
  assert.deepEqual(parseGitHubActionExecutionInput({
    conversationId: "conv-1",
    turnId: "turn-9",
    confirmed: true,
    action: { kind: "merge", repo: "OpenCoven/coven-cave", number: 7, method: "rebase" },
  }).action.method, "rebase");
  assert.deepEqual(parseGitHubActionExecutionInput({
    conversationId: "conv-1",
    turnId: "turn-9",
    confirmed: true,
    action: { kind: "rerun", repo: "OpenCoven/coven-cave", runId: "12345" },
  }).action.runId, "12345");
  assert.deepEqual(parseGitHubActionExecutionInput({
    conversationId: "conv-1",
    turnId: "turn-9",
    confirmed: true,
    action: { kind: "dispatch", repo: "OpenCoven/coven-cave", workflow: "ci.yml", ref: "main" },
  }).action.workflow, "ci.yml");
  for (const action of [
    { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it", note: "extra" },
    { kind: "review", repo: "OpenCoven/coven-cave", number: 7, event: "APPROVE", body: "Ship it", note: "extra" },
    { kind: "merge", repo: "OpenCoven/coven-cave", number: 7, method: "merge", deleteBranch: true },
    { kind: "rerun", repo: "OpenCoven/coven-cave", runId: "12345", failedOnly: false },
    { kind: "dispatch", repo: "OpenCoven/coven-cave", workflow: "ci.yml", ref: "main", inputs: { env: "prod" } },
  ]) {
    assert.throws(() => parseGitHubActionExecutionInput({
      conversationId: "conv-1",
      turnId: "turn-9",
      confirmed: true,
      action,
    }), /unexpected fields/i);
  }

  assert.throws(() => parseGitHubActionExecutionInput({
    conversationId: "conv-1",
    turnId: "turn-9",
    action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" },
  }), /confirmed/i);
  assert.throws(() => parseGitHubActionExecutionInput({
    conversationId: "conv-1",
    turnId: "turn-9",
    confirmed: true,
    action: { kind: "comment", repo: "bad repo", number: 7, body: "Ship it" },
  }));
  assert.throws(() => parseGitHubActionExecutionInput({
    conversationId: "conv-1",
    turnId: "turn-9",
    confirmed: true,
    action: { kind: "explode", repo: "OpenCoven/coven-cave" },
  }));
});

test("attention responses require the current canonical request turn and reserve one stable response operation", async () => {
  const conversation = {
    sessionId: "conv-1",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:/workspace/project",
    turns: [
      { id: "user-1", role: "user", text: "Should we merge this?", createdAt: "2026-08-10T10:00:00.000Z" },
      {
        id: "assistant-1",
        role: "assistant",
        text: "Please confirm the merge.",
        createdAt: "2026-08-10T10:01:00.000Z",
        responseMetadata: {
          attentionRequest: {
            sessionId: "conv-1",
            turnId: "assistant-1",
            requestedAt: "2026-08-10T10:01:00.000Z",
            reason: "approval",
          },
        },
      },
    ],
    attentionEvidence: {
      latestCompletedTurn: { role: "assistant", at: "2026-08-10T10:01:00.000Z" },
      latestUserTurnAt: "2026-08-10T10:00:00.000Z",
      request: {
        sessionId: "conv-1",
        turnId: "stale-summary-turn",
        requestedAt: "2026-08-10T10:01:00.000Z",
        reason: "approval",
      },
    },
  };
  let saves = 0;
  const service = createClientActionService({
    authorizeConversation: authorizeConversation(conversation),
    saveConversation: async () => {
      saves += 1;
    },
  });

  const prepared = await service.prepareAttentionResponse("assistant-1", {
    conversationId: "conv-1",
    prompt: "  Approved — go ahead.  ",
  }, "9f4145de-9b43-4abc-876d-81ef63de60e0");
  assert.deepEqual(prepared, {
    ok: true,
    send: {
      operationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
      conversationId: "conv-1",
      familiarId: "charm",
      prompt: "Approved — go ahead.",
      attachmentIds: [],
      projectRoot: "/workspace/project",
    },
  });
  assert.equal(saves, 1, "the winning response reserves the attention request durably before launch");
  assert.deepEqual(conversation.turns[1].responseMetadata.attentionResponse, {
    operationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
  });

  const staleService = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [],
      attentionEvidence: { latestCompletedTurn: null, latestUserTurnAt: null, request: null },
    }),
    saveConversation: async () => {},
  });
  const stale = await staleService.prepareAttentionResponse("assistant-1", {
    conversationId: "conv-1",
    prompt: "still trying",
  }, "1f4145de-9b43-4abc-876d-81ef63de60e0");
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.equal(stale.code, "conflict");
});

test("attention response reservations survive crash retries for the winner and block competing operations", async () => {
  const conversation = {
    sessionId: "conv-1",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:/workspace/project",
    turns: [
      { id: "user-1", role: "user", text: "Should we merge this?", createdAt: "2026-08-10T10:00:00.000Z" },
      {
        id: "assistant-1",
        role: "assistant",
        text: "Please confirm the merge.",
        createdAt: "2026-08-10T10:01:00.000Z",
        responseMetadata: {
          attentionRequest: {
            sessionId: "conv-1",
            turnId: "assistant-1",
            requestedAt: "2026-08-10T10:01:00.000Z",
            reason: "approval",
          },
        },
      },
    ],
  };
  let saves = 0;
  const saveConversation = async () => {
    saves += 1;
  };
  const winningOperationId = "3f4145de-9b43-4abc-876d-81ef63de60e0";
  const firstService = createClientActionService({
    authorizeConversation: authorizeConversation(conversation),
    saveConversation,
  });
  const first = await firstService.prepareAttentionResponse(
    "assistant-1",
    { conversationId: "conv-1", prompt: "Approved." },
    winningOperationId,
  );
  assert.equal(first.ok, true);
  assert.equal(saves, 1);

  const retryService = createClientActionService({
    authorizeConversation: authorizeConversation(conversation),
    saveConversation,
  });
  const retry = await retryService.prepareAttentionResponse(
    "assistant-1",
    { conversationId: "conv-1", prompt: "Approved." },
    winningOperationId,
  );
  assert.deepEqual(retry, first, "the winner reuses its stored response operation after a crash/retry");
  assert.equal(saves, 1, "exact retries must not rewrite the reservation");

  const competing = await retryService.prepareAttentionResponse(
    "assistant-1",
    { conversationId: "conv-1", prompt: "Approved." },
    "4f4145de-9b43-4abc-876d-81ef63de60e0",
  );
  assert.equal(competing.ok, false);
  assert.equal(competing.status, 409);
  assert.equal(competing.code, "conflict");
  assert.match(competing.message, /already being answered/i);
  assert.equal(saves, 1, "a competing operation must fail before any second launch can be reserved");
});

test("concurrent attention responses elect exactly one winner under the conversation lock", async () => {
  const conversation = {
    sessionId: "conv-1",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:/workspace/project",
    turns: [
      { id: "user-1", role: "user", text: "Should we merge this?", createdAt: "2026-08-10T10:00:00.000Z" },
      {
        id: "assistant-1",
        role: "assistant",
        text: "Please confirm the merge.",
        createdAt: "2026-08-10T10:01:00.000Z",
        responseMetadata: {
          attentionRequest: {
            sessionId: "conv-1",
            turnId: "assistant-1",
            requestedAt: "2026-08-10T10:01:00.000Z",
            reason: "approval",
          },
        },
      },
    ],
  };
  let saves = 0;
  const service = createClientActionService({
    authorizeConversation: lockingAuthorizeConversation(conversation),
    saveConversation: async () => {
      saves += 1;
    },
  });

  const winner = service.prepareAttentionResponse(
    "assistant-1",
    { conversationId: "conv-1", prompt: "Approved." },
    "5f4145de-9b43-4abc-876d-81ef63de60e0",
  );
  const loser = service.prepareAttentionResponse(
    "assistant-1",
    { conversationId: "conv-1", prompt: "Approved." },
    "6f4145de-9b43-4abc-876d-81ef63de60e0",
  );
  const [winnerResult, loserResult] = await Promise.all([winner, loser]);

  assert.equal(winnerResult.ok, true);
  assert.equal(loserResult.ok, false);
  assert.equal(loserResult.status, 409);
  assert.equal(loserResult.code, "conflict");
  assert.equal(saves, 1, "only one response operation may reserve the canonical attention turn");
  assert.deepEqual(conversation.turns[1].responseMetadata.attentionResponse, {
    operationId: "5f4145de-9b43-4abc-876d-81ef63de60e0",
  });
});

test("attention responses fail closed on tampered turn metadata even if summary evidence is forged", async () => {
  const service = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "Please confirm the merge.",
          createdAt: "2026-08-10T10:01:00.000Z",
          responseMetadata: {
            attentionRequest: {
              sessionId: "other-session",
              turnId: "assistant-1",
              requestedAt: "2026-08-10T10:01:00.000Z",
              reason: "approval",
            },
          },
        },
      ],
      attentionEvidence: {
        latestCompletedTurn: { role: "assistant", at: "2026-08-10T10:01:00.000Z" },
        latestUserTurnAt: null,
        request: {
          sessionId: "conv-1",
          turnId: "assistant-1",
          requestedAt: "2026-08-10T10:01:00.000Z",
          reason: "approval",
        },
      },
    }),
    saveConversation: async () => {},
  });

  const tampered = await service.prepareAttentionResponse("assistant-1", {
    conversationId: "conv-1",
    prompt: "Approved.",
  }, "2f4145de-9b43-4abc-876d-81ef63de60e0");
  assert.equal(tampered.ok, false);
  assert.equal(tampered.status, 409);
  assert.equal(tampered.code, "conflict");
});

test("task handoffs only execute the exact canonical proposal and build bounded receipts from visible turns", async () => {
  let captured = null;
  const service = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        { id: "user-1", role: "user", text: "Please clean up the release checklist.", createdAt: "2026-08-10T10:00:00.000Z" },
        {
          id: "assistant-1",
          role: "assistant",
          text: [
            "I can package that into a task.",
            "<coven:github kind=\"pr\" repo=\"OpenCoven/coven-cave\" number=\"7\" />",
            "<coven:next-paths>",
            "- [task] Create the release follow-up task",
            "</coven:next-paths>",
          ].join("\n"),
          createdAt: "2026-08-10T10:01:00.000Z",
        },
      ],
    }),
    createTaskFromChat: async (input) => {
      captured = input;
      return {
        ok: true,
        card: {
          id: "card-1",
          title: input.title,
          status: "inbox",
          familiarId: "charm",
          projectId: "proj-1",
          createdAt: "2026-08-10T10:02:00.000Z",
          updatedAt: "2026-08-10T10:02:00.000Z",
        },
      };
    },
    resolveProjectId: async () => "proj-1",
  });

  const success = await service.handoffTask({
    conversationId: "conv-1",
    turnId: "assistant-1",
    prompt: "Create the release follow-up task",
    title: "Ship the checklist follow-up",
  });
  assert.equal(success.ok, true, JSON.stringify(success));
  assert.deepEqual(captured, {
    sessionId: "conv-1",
    context: {
      turns: [
        { id: "user-1", role: "user", text: "Please clean up the release checklist.", createdAt: "2026-08-10T10:00:00.000Z" },
        { id: "assistant-1", role: "assistant", text: "I can package that into a task.", createdAt: "2026-08-10T10:01:00.000Z" },
      ],
      familiarId: "charm",
      projectId: "proj-1",
    },
    title: "Ship the checklist follow-up",
  });
  assert.deepEqual(success, {
    ok: true,
    receipt: {
      source: {
        conversationId: "conv-1",
        turnId: "assistant-1",
        prompt: "Create the release follow-up task",
      },
      task: {
        id: "card-1",
        title: "Ship the checklist follow-up",
        status: "inbox",
        familiarId: "charm",
        projectId: "proj-1",
        createdAt: "2026-08-10T10:02:00.000Z",
        updatedAt: "2026-08-10T10:02:00.000Z",
      },
    },
  });

  const stale = await service.handoffTask({
    conversationId: "conv-1",
    turnId: "assistant-1",
    prompt: "A different task prompt",
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.equal(captured.title, "Ship the checklist follow-up", "stale proposals never execute createTaskFromChat again");
});

test("GitHub actions require confirmed canonical proposals and never execute a tampered payload", async () => {
  let executed = 0;
  const service = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        { id: "user-1", role: "user", text: "Leave the approval comment.", createdAt: "2026-08-10T10:00:00.000Z" },
        {
          id: "assistant-1",
          role: "assistant",
          text: '<coven:github-action kind="comment" repo="OpenCoven/coven-cave" number="7" body="Ship it" note="Looks ready" />',
          createdAt: "2026-08-10T10:01:00.000Z",
        },
      ],
    }),
    executeGitHubComment: async (input) => {
      executed += 1;
      assert.deepEqual(input, { repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" });
      return {
        ok: true,
        comment: {
          id: "91",
          body: "Ship it",
          createdAt: "2026-08-10T10:02:00.000Z",
          url: "https://github.com/OpenCoven/coven-cave/issues/7#issuecomment-91",
        },
      };
    },
  });

  const success = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" },
  });
  assert.deepEqual(success, {
    ok: true,
    receipt: {
      source: { conversationId: "conv-1", turnId: "assistant-1" },
      action: {
        kind: "comment",
        repo: "OpenCoven/coven-cave",
        number: 7,
        body: "Ship it",
        bodyBytes: 7,
        bodySha256: sha256Hex("Ship it"),
      },
      result: {
        kind: "comment",
        commentId: "91",
        body: "Ship it",
        bodyBytes: 7,
        bodySha256: sha256Hex("Ship it"),
        createdAt: "2026-08-10T10:02:00.000Z",
        url: "https://github.com/OpenCoven/coven-cave/issues/7#issuecomment-91",
      },
    },
  });
  assert.equal(executed, 1);

  const tampered = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "A different body" },
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.status, 409);
  assert.equal(executed, 1, "tampered payloads never call the GitHub executor");
});

test("GitHub action failures map to typed client-v1 errors", async () => {
  const service = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        {
          id: "assistant-1",
          role: "assistant",
          text: '<coven:github-action kind="merge" repo="OpenCoven/coven-cave" number="7" method="merge" />',
          createdAt: "2026-08-10T10:01:00.000Z",
        },
      ],
    }),
    executeGitHubMerge: async () => ({ ok: false, status: 403, error: "Branch protection blocks this merge.", reason: "upstream" }),
  });

  const blocked = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "merge", repo: "OpenCoven/coven-cave", number: 7, method: "merge" },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.code, "conflict");
  assert.match(blocked.message, /Branch protection/);

  const unavailable = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        {
          id: "assistant-2",
          role: "assistant",
          text: '<coven:github-action kind="dispatch" repo="OpenCoven/coven-cave" workflow="ci.yml" ref="main" />',
          createdAt: "2026-08-10T10:01:00.000Z",
        },
      ],
    }),
    executeGitHubDispatch: async () => ({ ok: false, status: 401, error: "auth_required", reason: "auth_required" }),
  });

  const missingGitHub = await unavailable.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-2",
    confirmed: true,
    action: { kind: "dispatch", repo: "OpenCoven/coven-cave", workflow: "ci.yml", ref: "main" },
  });
  assert.equal(missingGitHub.ok, false);
  assert.equal(missingGitHub.status, 503);
  assert.equal(missingGitHub.code, "service_unavailable");
});

test("GitHub comment receipts stay bounded for ledger persistence", async () => {
  const huge = "🪄".repeat(20_000);
  const service = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        {
          id: "assistant-1",
          role: "assistant",
          text: `<coven:github-action kind="comment" repo="OpenCoven/coven-cave" number="7" body="${huge}" />`,
          createdAt: "2026-08-10T10:01:00.000Z",
        },
      ],
    }),
    executeGitHubComment: async () => ({
      ok: true,
      comment: {
        id: "91",
        body: huge,
        createdAt: "2026-08-10T10:02:00.000Z",
        url: "https://github.com/OpenCoven/coven-cave/issues/7#issuecomment-91",
      },
    }),
  });

  const success = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: huge },
  });
  assert.equal(success.ok, true);
  assert.equal(success.receipt.action.bodyBytes, Buffer.byteLength(huge, "utf8"));
  assert.equal(success.receipt.result.bodyBytes, Buffer.byteLength(huge, "utf8"));
  assert.equal(success.receipt.action.bodySha256, sha256Hex(huge));
  assert.equal(success.receipt.result.bodySha256, sha256Hex(huge));
  assert.equal(success.receipt.action.bodyTruncated, true);
  assert.equal(success.receipt.result.bodyTruncated, true);
  assert.ok(success.receipt.action.body.length < huge.length);
  assert.ok(success.receipt.result.body.length < huge.length);
  assert.ok(
    Buffer.byteLength(JSON.stringify({ ok: true, action: success.receipt }), "utf8") < MAX_RESPONSE_BODY_BYTES,
    "the bounded receipt must fit inside the 64 KiB operation ledger body limit",
  );
});

test("successful GitHub effects replay the stored receipt without re-executing", async () => {
  const effects = createEffectStoreDouble();
  let executed = 0;
  const service = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        {
          id: "assistant-1",
          role: "assistant",
          text: '<coven:github-action kind="comment" repo="OpenCoven/coven-cave" number="7" body="Ship it" />',
          createdAt: "2026-08-10T10:01:00.000Z",
        },
      ],
    }),
    ...effects,
    reconcileGitHubActionEffect: async () => {
      throw new Error("success replays must not reconcile");
    },
    executeGitHubComment: async () => {
      executed += 1;
      return {
        ok: true,
        comment: {
          id: "91",
          body: "Ship it",
          createdAt: "2026-08-10T10:02:00.000Z",
          url: "https://github.com/OpenCoven/coven-cave/issues/7#issuecomment-91",
        },
      };
    },
  });

  const effectId = "3f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" },
  }, { effectId });
  const second = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" },
  }, { effectId });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(second, first);
  assert.equal(executed, 1, "effect replay must not execute the GitHub write twice");
});

test("GitHub effect capacity errors fail closed with a typed 503 before any dispatch", async () => {
  let executed = 0;
  const service = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        {
          id: "assistant-1",
          role: "assistant",
          text: '<coven:github-action kind="comment" repo="OpenCoven/coven-cave" number="7" body="Ship it" />',
          createdAt: "2026-08-10T10:01:00.000Z",
        },
      ],
    }),
    beginGitHubEffect: async () => {
      throw new GitHubEffectStoreCapacityError("full");
    },
    executeGitHubComment: async () => {
      executed += 1;
      return {
        ok: true,
        comment: {
          id: "91",
          body: "Ship it",
          createdAt: "2026-08-10T10:02:00.000Z",
          url: null,
        },
      };
    },
  });

  const result = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" },
  }, { effectId: "capacity-full" });

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.code, "service_unavailable");
  assert.equal(result.retryable, true);
  assert.equal(result.details?.reason, "github_effect_capacity_exceeded");
  assert.equal(executed, 0, "capacity failures must refuse dispatch before any GitHub write");
});

test("pending GitHub effects reconcile a crash window before any resend", async () => {
  const effects = createEffectStoreDouble();
  const effectId = "4f4145de-9b43-4abc-876d-81ef63de60e0";
  await effects.beginGitHubEffect({
    effectId,
    source: { conversationId: "conv-1", turnId: "assistant-1" },
    action: {
      kind: "comment",
      repo: "OpenCoven/coven-cave",
      number: 7,
      bodyPreview: "Ship it",
      bodyBytes: 7,
      bodySha256: sha256Hex("Ship it"),
      bodyTruncated: false,
    },
  });

  let executed = 0;
  let reconciled = 0;
  const service = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        {
          id: "assistant-1",
          role: "assistant",
          text: '<coven:github-action kind="comment" repo="OpenCoven/coven-cave" number="7" body="Ship it" />',
          createdAt: "2026-08-10T10:01:00.000Z",
        },
      ],
    }),
    ...effects,
    executeGitHubComment: async () => {
      executed += 1;
      return {
        ok: true,
        comment: { id: "91", body: "Ship it", createdAt: "2026-08-10T10:02:00.000Z", url: null },
      };
    },
    reconcileGitHubActionEffect: async ({ rootReason }) => {
      reconciled += 1;
      assert.equal(rootReason, "crash_window");
      return {
        kind: "success",
        result: {
          kind: "comment",
          commentId: "91",
          body: "Ship it",
          createdAt: "2026-08-10T10:02:00.000Z",
          url: "https://github.com/OpenCoven/coven-cave/issues/7#issuecomment-91",
        },
      };
    },
  });

  const result = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" },
  }, { effectId });

  assert.equal(result.ok, true);
  assert.equal(executed, 0, "crash-window retries reconcile before any resend");
  assert.equal(reconciled, 1);
  assert.equal(effects.read(effectId)?.state, "succeeded");
});

test("ambiguous GitHub outcomes persist manual reconciliation and never auto-resend", async () => {
  const effects = createEffectStoreDouble();
  let executed = 0;
  let reconciled = 0;
  const effectId = "5f4145de-9b43-4abc-876d-81ef63de60e0";
  const service = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        {
          id: "assistant-1",
          role: "assistant",
          text: '<coven:github-action kind="dispatch" repo="OpenCoven/coven-cave" workflow="ci.yml" ref="main" />',
          createdAt: "2026-08-10T10:01:00.000Z",
        },
      ],
    }),
    ...effects,
    executeGitHubDispatch: async () => {
      executed += 1;
      return { ok: false, status: 502, error: "gateway timeout", reason: "network" };
    },
    reconcileGitHubActionEffect: async ({ rootReason }) => {
      reconciled += 1;
      assert.equal(rootReason, "network_ambiguous");
      return {
        kind: "manual_reconciliation",
        failure: {
          code: "conflict",
          status: 409,
          retryable: false,
          reason: "network_ambiguous",
          message: "Verify the workflow dispatch manually.",
        },
      };
    },
  });

  const first = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "dispatch", repo: "OpenCoven/coven-cave", workflow: "ci.yml", ref: "main" },
  }, { effectId });
  const second = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "dispatch", repo: "OpenCoven/coven-cave", workflow: "ci.yml", ref: "main" },
  }, { effectId });

  assert.equal(first.ok, false);
  assert.equal(first.status, 409);
  assert.equal(first.details?.reason, "manual_reconciliation_required");
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.equal(second.details?.reason, "manual_reconciliation_required");
  assert.equal(executed, 1, "manual reconciliation blocks any second dispatch");
  assert.equal(reconciled, 1, "once persisted, later retries replay the manual state");
});

test("known pre-effect failures can re-dispatch on a reclaimed effect record", async () => {
  const effects = createEffectStoreDouble();
  let executed = 0;
  let allow = false;
  const effectId = "6f4145de-9b43-4abc-876d-81ef63de60e0";
  const service = createClientActionService({
    authorizeConversation: authorizeConversation({
      sessionId: "conv-1",
      familiarId: "charm",
      harness: "claude",
      runtime: "local:/workspace/project",
      turns: [
        {
          id: "assistant-1",
          role: "assistant",
          text: '<coven:github-action kind="merge" repo="OpenCoven/coven-cave" number="7" method="merge" />',
          createdAt: "2026-08-10T10:01:00.000Z",
        },
      ],
    }),
    ...effects,
    reconcileGitHubActionEffect: async () => {
      throw new Error("known pre-effect failures must not reconcile");
    },
    executeGitHubMerge: async () => {
      executed += 1;
      return allow
        ? { ok: true, merged: true, sha: "deadbeef", branchDeleted: false, branchDeleteError: null }
        : { ok: false, status: 403, error: "Branch protection blocks this merge.", reason: "upstream" };
    },
  });

  const first = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "merge", repo: "OpenCoven/coven-cave", number: 7, method: "merge" },
  }, { effectId });
  assert.equal(first.ok, false);
  assert.equal(first.status, 409);
  assert.equal(first.details?.reason, "github_pre_effect_failure");

  allow = true;
  const second = await service.executeGitHubAction({
    conversationId: "conv-1",
    turnId: "assistant-1",
    confirmed: true,
    action: { kind: "merge", repo: "OpenCoven/coven-cave", number: 7, method: "merge" },
  }, { effectId });

  assert.equal(second.ok, true);
  assert.equal(executed, 2, "retryable failure state allows a reclaimed effect to re-dispatch");
});
