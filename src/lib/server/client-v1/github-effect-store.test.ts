// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

const root = path.join(process.cwd(), ".test-tmp", `github-effect-store-${crypto.randomUUID()}`);
await mkdir(root, { recursive: true });
process.env.COVEN_CAVE_CLIENT_GITHUB_EFFECT_STORE_PATH = path.join(root, "github-effects.json");

const store = await import("./github-effect-store.ts");

after(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  const storePath = process.env.COVEN_CAVE_CLIENT_GITHUB_EFFECT_STORE_PATH;
  store.setGitHubEffectStoreReadFileForTest(null);
  await rm(storePath, { force: true });
  await rm(`${storePath}.lock.sqlite3`, { force: true });
  await rm(`${storePath}.lock.sqlite3-shm`, { force: true });
  await rm(`${storePath}.lock.sqlite3-wal`, { force: true });
});

function source() {
  return { conversationId: "conv-1", turnId: "assistant-1" };
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sliceUtf8Bytes(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { value: text, truncated: false };
  }
  let sliced = "";
  let usedBytes = 0;
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (usedBytes + charBytes > maxBytes) break;
    sliced += char;
    usedBytes += charBytes;
  }
  return { value: sliced.trimEnd(), truncated: true };
}

function boundedText(text, maxBytes) {
  const bytes = Buffer.byteLength(text, "utf8");
  const sliced = sliceUtf8Bytes(text, maxBytes);
  return {
    text: sliced.value,
    bytes,
    sha256: sha256Hex(text),
    truncated: sliced.truncated,
  };
}

function auditTextFields(text) {
  const bounded = boundedText(text, 512);
  return {
    bodyPreview: bounded.text,
    bodyBytes: bounded.bytes,
    bodySha256: bounded.sha256,
    bodyTruncated: bounded.truncated,
  };
}

function receiptTextFields(text) {
  const bounded = boundedText(text, 2_048);
  return {
    body: bounded.text,
    bodyBytes: bounded.bytes,
    bodySha256: bounded.sha256,
    ...(bounded.truncated ? { bodyTruncated: true } : {}),
  };
}

function commentAudit(body = "Ship it") {
  return {
    kind: "comment",
    repo: "OpenCoven/coven-cave",
    number: 7,
    ...auditTextFields(body),
  };
}

function reviewAudit({ event = "REQUEST_CHANGES", body = "Needs tests" } = {}) {
  return {
    kind: "review",
    repo: "OpenCoven/coven-cave",
    number: 7,
    event,
    ...(body === undefined ? {} : auditTextFields(body)),
  };
}

function mergeAudit(method = "merge") {
  return {
    kind: "merge",
    repo: "OpenCoven/coven-cave",
    number: 7,
    method,
  };
}

function rerunAudit(runId = "12345") {
  return {
    kind: "rerun",
    repo: "OpenCoven/coven-cave",
    runId,
  };
}

function dispatchAudit(workflow = "ci.yml", ref = "main") {
  return {
    kind: "dispatch",
    repo: "OpenCoven/coven-cave",
    workflow,
    ref,
  };
}

function commentReceipt(body = "Ship it") {
  return {
    source: source(),
    action: {
      kind: "comment",
      repo: "OpenCoven/coven-cave",
      number: 7,
      ...receiptTextFields(body),
    },
    result: {
      kind: "comment",
      commentId: "91",
      ...receiptTextFields(body),
      createdAt: "2026-08-10T10:02:00.000Z",
      url: "https://github.com/OpenCoven/coven-cave/issues/7#issuecomment-91",
    },
  };
}

function reviewReceipt({ event = "REQUEST_CHANGES", body = "Needs tests", state } = {}) {
  return {
    source: source(),
    action: {
      kind: "review",
      repo: "OpenCoven/coven-cave",
      number: 7,
      event,
      ...(body === undefined ? {} : receiptTextFields(body)),
    },
    result: {
      kind: "review",
      reviewId: "92",
      state: state ?? (event === "APPROVE" ? "APPROVED" : event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED"),
      url: "https://github.com/OpenCoven/coven-cave/pull/7#pullrequestreview-92",
    },
  };
}

function mergeReceipt(method = "merge") {
  return {
    source: source(),
    action: {
      kind: "merge",
      repo: "OpenCoven/coven-cave",
      number: 7,
      method,
    },
    result: {
      kind: "merge",
      merged: true,
      sha: "a".repeat(40),
      branchDeleted: false,
      branchDeleteError: null,
    },
  };
}

function rerunReceipt(runId = "12345") {
  return {
    source: source(),
    action: {
      kind: "rerun",
      repo: "OpenCoven/coven-cave",
      runId,
    },
    result: {
      kind: "rerun",
      accepted: true,
    },
  };
}

function dispatchReceipt(workflow = "ci.yml", ref = "main") {
  return {
    source: source(),
    action: {
      kind: "dispatch",
      repo: "OpenCoven/coven-cave",
      workflow,
      ref,
    },
    result: {
      kind: "dispatch",
      accepted: true,
    },
  };
}

function effectId(index) {
  return `7f4145de-9b43-4abc-876d-${index.toString(16).padStart(12, "0")}`;
}

function isoAt(index) {
  return new Date(Date.UTC(2026, 7, 10, 10, 0, index)).toISOString();
}

function effectClaim(generation = 1) {
  return { generation, token: crypto.randomUUID() };
}

function pendingRecord(index, action = commentAudit(`pending-${index}`)) {
  const at = isoAt(index);
  return {
    effectId: effectId(index),
    state: "pending",
    source: source(),
    action,
    claim: effectClaim(1),
    createdAt: at,
    updatedAt: at,
    pendingSince: at,
    receipt: null,
    lastFailure: null,
    attempts: [{ at, outcome: "started", reason: null, status: null }],
  };
}

function succeededRecord(index, action, receipt) {
  const createdAt = isoAt(index);
  const updatedAt = isoAt(index + 1);
  return {
    effectId: effectId(index),
    state: "succeeded",
    source: source(),
    action,
    claim: null,
    createdAt,
    updatedAt,
    pendingSince: null,
    receipt,
    lastFailure: null,
    attempts: [
      { at: createdAt, outcome: "started", reason: null, status: null },
      { at: updatedAt, outcome: "succeeded", reason: "direct", status: 200 },
    ],
  };
}

function succeededRecordForVariant(kind, index) {
  switch (kind) {
    case "comment": {
      const body = `comment-${index}`;
      return succeededRecord(index, commentAudit(body), commentReceipt(body));
    }
    case "review": {
      const body = `Needs tests ${index}`;
      return succeededRecord(index, reviewAudit({ event: "REQUEST_CHANGES", body }), reviewReceipt({ event: "REQUEST_CHANGES", body }));
    }
    case "merge":
      return succeededRecord(index, mergeAudit("merge"), mergeReceipt("merge"));
    case "rerun": {
      const runId = String(12000 + index);
      return succeededRecord(index, rerunAudit(runId), rerunReceipt(runId));
    }
    case "dispatch": {
      const workflow = `ci-${index}.yml`;
      return succeededRecord(index, dispatchAudit(workflow, "main"), dispatchReceipt(workflow, "main"));
    }
    default:
      throw new Error(`unsupported variant ${kind}`);
  }
}

function failureSnapshot(reason, message, { code = "conflict", status = 409, retryable = false } = {}) {
  return {
    code,
    status,
    retryable,
    reason,
    message,
  };
}

async function seedEffects(effects) {
  await writeFile(
    process.env.COVEN_CAVE_CLIENT_GITHUB_EFFECT_STORE_PATH,
    JSON.stringify({ version: 1, effects }, null, 2),
  );
}

async function persistedStoreRaw() {
  return readFile(process.env.COVEN_CAVE_CLIENT_GITHUB_EFFECT_STORE_PATH, "utf8");
}

async function persistedEffect(effectIdValue) {
  const parsed = JSON.parse(await persistedStoreRaw());
  return parsed.effects.find((effect) => effect.effectId === effectIdValue) ?? null;
}

test("beginGitHubEffect persists a durable pending record before dispatch and replays known success", async () => {
  const githubEffectId = "7f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await store.beginGitHubEffect({
    effectId: githubEffectId,
    source: source(),
    action: commentAudit(),
  });
  assert.equal(first.kind, "dispatch");
  assert.equal(first.record.state, "pending");
  assert.equal(first.claim.generation, 1);
  assert.equal(first.record.attempts.length, 1, "the first attempt is durably recorded before any external dispatch");

  const receipt = commentReceipt();
  assert.equal(
    await store.settleGitHubEffectSuccess({
      effectId: githubEffectId,
      receipt,
      expected: { state: "pending", claim: first.claim },
    }),
    true,
  );

  const replay = await store.beginGitHubEffect({
    effectId: githubEffectId,
    source: source(),
    action: commentAudit(),
  });
  assert.equal(replay.kind, "replay");
  assert.deepEqual(replay.receipt, receipt);
});

test("strict receipt validation still replays valid succeeded variants", async () => {
  const variants = ["comment", "review", "merge", "rerun", "dispatch"];
  for (const [offset, kind] of variants.entries()) {
    const record = succeededRecordForVariant(kind, 20 + offset * 10);
    await seedEffects([record]);
    const replay = await store.beginGitHubEffect({
      effectId: record.effectId,
      source: source(),
      action: record.action,
    });
    assert.equal(replay.kind, "replay", `${kind} receipts should remain replayable when well-formed`);
  }
});

test("retryable failures re-dispatch while manual reconciliation blocks later sends", async () => {
  const retryableId = "8f4145de-9b43-4abc-876d-81ef63de60e0";
  const retryableStart = await store.beginGitHubEffect({
    effectId: retryableId,
    source: source(),
    action: commentAudit(),
  });
  assert.equal(retryableStart.kind, "dispatch");
  assert.equal(
    await store.settleGitHubEffectRetryableFailure({
      effectId: retryableId,
      failure: failureSnapshot("upstream_rejected", "Branch protection blocks this merge."),
      expected: { state: "pending", claim: retryableStart.claim },
    }),
    true,
  );
  const retried = await store.beginGitHubEffect({
    effectId: retryableId,
    source: source(),
    action: commentAudit(),
  });
  assert.equal(retried.kind, "dispatch");

  const manualId = "9f4145de-9b43-4abc-876d-81ef63de60e0";
  const manualStart = await store.beginGitHubEffect({
    effectId: manualId,
    source: source(),
    action: commentAudit(),
  });
  assert.equal(manualStart.kind, "dispatch");
  assert.equal(
    await store.settleGitHubEffectManualReconciliation({
      effectId: manualId,
      failure: failureSnapshot("network_ambiguous", "Verify the workflow dispatch manually."),
      expected: { state: "pending", claim: manualStart.claim },
    }),
    true,
  );
  const blocked = await store.beginGitHubEffect({
    effectId: manualId,
    source: source(),
    action: commentAudit(),
  });
  assert.equal(blocked.kind, "manual_reconciliation");
  assert.equal(blocked.failure.reason, "network_ambiguous");
});

test("capacity evicts only terminal effects and never pending ones", async () => {
  await seedEffects([
    succeededRecord(900, commentAudit("succeeded-900"), commentReceipt("succeeded-900")),
    ...Array.from({ length: 511 }, (_, index) => pendingRecord(index)),
  ]);

  const created = await store.beginGitHubEffect({
    effectId: effectId(901),
    source: source(),
    action: commentAudit("fresh"),
  });
  assert.equal(created.kind, "dispatch");

  const persisted = JSON.parse(await persistedStoreRaw());
  assert.equal(persisted.effects.length, 512);
  assert.equal(
    persisted.effects.some((effect) => effect.effectId === effectId(900)),
    false,
    "the oldest terminal record is the eviction victim",
  );
  assert.equal(
    persisted.effects.some((effect) => effect.effectId === effectId(0)),
    true,
    "live pending effects must remain durable at capacity",
  );

  const retry = await store.beginGitHubEffect({
    effectId: effectId(0),
    source: source(),
    action: commentAudit("pending-0"),
  });
  assert.equal(retry.kind, "reconcile");
  assert.equal(retry.claim.generation, 2);
});

test("capacity full of pending effects fails closed without evicting the original record", async () => {
  await seedEffects(Array.from({ length: 512 }, (_, index) => pendingRecord(index)));

  await assert.rejects(
    store.beginGitHubEffect({
      effectId: effectId(512),
      source: source(),
      action: commentAudit("overflow"),
    }),
    (error) => error instanceof store.GitHubEffectStoreCapacityError,
  );

  const persisted = JSON.parse(await persistedStoreRaw());
  assert.equal(persisted.effects.length, 512);
  assert.equal(
    persisted.effects.some((effect) => effect.effectId === effectId(0)),
    true,
    "the original pending effect must never be evicted just to admit a 513th live record",
  );

  const retry = await store.beginGitHubEffect({
    effectId: effectId(0),
    source: source(),
    action: commentAudit("pending-0"),
  });
  assert.equal(retry.kind, "reconcile", "retrying the preserved record must not redispatch");
  assert.equal(retry.claim.generation, 2);
});

test("pending records remain readable after the retained attempt window truncates older cycles", async () => {
  const githubEffectId = effectId(950);
  let current = await store.beginGitHubEffect({
    effectId: githubEffectId,
    source: source(),
    action: commentAudit("Ship it"),
    at: isoAt(400),
  });
  assert.equal(current.kind, "dispatch");

  for (let cycle = 1; cycle <= 8; cycle += 1) {
    current = await store.beginGitHubEffect({
      effectId: githubEffectId,
      source: source(),
      action: commentAudit("Ship it"),
      at: isoAt(400 + cycle),
    });
    assert.equal(current.kind, "reconcile");
    assert.equal(current.claim.generation, cycle + 1);
  }

  const persisted = await persistedEffect(githubEffectId);
  assert.equal(persisted.createdAt, isoAt(400), "the durable origin timestamp stays immutable");
  assert.equal(persisted.updatedAt, isoAt(408));
  assert.equal(persisted.attempts.length, 8, "the bounded attempt log keeps only the newest retained window");
  assert.deepEqual(
    persisted.attempts.map((attempt) => attempt.at),
    Array.from({ length: 8 }, (_, index) => isoAt(401 + index)),
  );

  const afterTruncation = await store.beginGitHubEffect({
    effectId: githubEffectId,
    source: source(),
    action: commentAudit("Ship it"),
    at: isoAt(409),
  });
  assert.equal(afterTruncation.kind, "reconcile");
  assert.equal(afterTruncation.claim.generation, 10);
  assert.equal(afterTruncation.record.attempts.length, 8);
  assert.deepEqual(
    afterTruncation.record.attempts.map((attempt) => attempt.at),
    Array.from({ length: 8 }, (_, index) => isoAt(402 + index)),
  );
});

test("non-ENOENT read failures fail closed and never overwrite the prior effect state", async () => {
  const preservedId = "af4145de-9b43-4abc-876d-81ef63de60e0";
  const preservedReceipt = commentReceipt("Preserve me");
  const reserved = await store.beginGitHubEffect({
    effectId: preservedId,
    source: source(),
    action: commentAudit("Preserve me"),
  });
  assert.equal(reserved.kind, "dispatch");
  await store.settleGitHubEffectSuccess({
    effectId: preservedId,
    receipt: preservedReceipt,
    expected: { state: "pending", claim: reserved.claim },
  });

  store.setGitHubEffectStoreReadFileForTest(async () => {
    const error = new Error("permission denied");
    // @ts-expect-error deliberate errno simulation
    error.code = "EACCES";
    throw error;
  });

  await assert.rejects(
    store.beginGitHubEffect({
      effectId: "bf4145de-9b43-4abc-876d-81ef63de60e0",
      source: source(),
      action: commentAudit("Blocked"),
    }),
    /GitHub effect store is unreadable/,
  );

  store.setGitHubEffectStoreReadFileForTest(null);

  const replay = await store.beginGitHubEffect({
    effectId: preservedId,
    source: source(),
    action: commentAudit("Preserve me"),
  });
  assert.equal(replay.kind, "replay");
  assert.deepEqual(replay.receipt, preservedReceipt);

  const persisted = JSON.parse(await persistedStoreRaw());
  assert.equal(
    persisted.effects.some((effect) => effect.effectId === "bf4145de-9b43-4abc-876d-81ef63de60e0"),
    false,
    "the failed read must not authorize a new dispatch or overwrite the prior store contents",
  );
});

test("stale original claimants fail closed after a reclaim across every settlement variant", async () => {
  const cases = [
    {
      name: "success",
      stale: (effectIdValue, claim, at) => store.settleGitHubEffectSuccess({
        effectId: effectIdValue,
        receipt: commentReceipt("Ship it"),
        expected: { state: "pending", claim },
        at,
      }),
      current: (effectIdValue, claim, at) => store.settleGitHubEffectManualReconciliation({
        effectId: effectIdValue,
        failure: failureSnapshot("network_ambiguous", "Verify the workflow dispatch manually."),
        expected: { state: "pending", claim },
        at,
      }),
      finalState: "manual_reconciliation",
    },
    {
      name: "retryable_failure",
      stale: (effectIdValue, claim, at) => store.settleGitHubEffectRetryableFailure({
        effectId: effectIdValue,
        failure: failureSnapshot("upstream_rejected", "Branch protection blocks this merge."),
        expected: { state: "pending", claim },
        at,
      }),
      current: (effectIdValue, claim, at) => store.settleGitHubEffectSuccess({
        effectId: effectIdValue,
        receipt: commentReceipt("Ship it"),
        expected: { state: "pending", claim },
        at,
      }),
      finalState: "succeeded",
    },
    {
      name: "manual_reconciliation",
      stale: (effectIdValue, claim, at) => store.settleGitHubEffectManualReconciliation({
        effectId: effectIdValue,
        failure: failureSnapshot("reconciliation_unavailable", "GitHub reconciliation is unavailable."),
        expected: { state: "pending", claim },
        at,
      }),
      current: (effectIdValue, claim, at) => store.settleGitHubEffectRetryableFailure({
        effectId: effectIdValue,
        failure: failureSnapshot("upstream_rejected", "Branch protection blocks this merge."),
        expected: { state: "pending", claim },
        at,
      }),
      finalState: "retryable_failure",
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    const githubEffectId = effectId(1_000 + index);
    const first = await store.beginGitHubEffect({
      effectId: githubEffectId,
      source: source(),
      action: commentAudit("Ship it"),
      at: isoAt(200 + index * 10),
    });
    assert.equal(first.kind, "dispatch");

    const reclaimed = await store.beginGitHubEffect({
      effectId: githubEffectId,
      source: source(),
      action: commentAudit("Ship it"),
      at: isoAt(201 + index * 10),
    });
    assert.equal(reclaimed.kind, "reconcile");
    assert.equal(reclaimed.claim.generation, first.claim.generation + 1);
    assert.notEqual(reclaimed.claim.token, first.claim.token);

    const [staleSettled, currentSettled] = await Promise.all([
      scenario.stale(githubEffectId, first.claim, isoAt(202 + index * 10)),
      scenario.current(githubEffectId, reclaimed.claim, isoAt(203 + index * 10)),
    ]);

    assert.equal(staleSettled, false, `${scenario.name} must fail closed once the original claimant is stale`);
    assert.equal(currentSettled, true, `${scenario.name} should still settle for the current claimant`);

    const persisted = await persistedEffect(githubEffectId);
    assert.equal(persisted.state, scenario.finalState);
    assert.equal(persisted.claim, null);
  }
});

test("stale reconcilers fail closed after a newer reclaim across every settlement variant", async () => {
  const cases = [
    {
      name: "success",
      stale: (effectIdValue, claim, at) => store.settleGitHubEffectSuccess({
        effectId: effectIdValue,
        receipt: commentReceipt("Ship it"),
        expected: { state: "pending", claim },
        at,
      }),
      current: (effectIdValue, claim, at) => store.settleGitHubEffectRetryableFailure({
        effectId: effectIdValue,
        failure: failureSnapshot("upstream_rejected", "Branch protection blocks this merge."),
        expected: { state: "pending", claim },
        at,
      }),
      finalState: "retryable_failure",
    },
    {
      name: "retryable_failure",
      stale: (effectIdValue, claim, at) => store.settleGitHubEffectRetryableFailure({
        effectId: effectIdValue,
        failure: failureSnapshot("upstream_rejected", "Branch protection blocks this merge."),
        expected: { state: "pending", claim },
        at,
      }),
      current: (effectIdValue, claim, at) => store.settleGitHubEffectManualReconciliation({
        effectId: effectIdValue,
        failure: failureSnapshot("network_ambiguous", "Verify the workflow dispatch manually."),
        expected: { state: "pending", claim },
        at,
      }),
      finalState: "manual_reconciliation",
    },
    {
      name: "manual_reconciliation",
      stale: (effectIdValue, claim, at) => store.settleGitHubEffectManualReconciliation({
        effectId: effectIdValue,
        failure: failureSnapshot("reconciliation_unavailable", "GitHub reconciliation is unavailable."),
        expected: { state: "pending", claim },
        at,
      }),
      current: (effectIdValue, claim, at) => store.settleGitHubEffectSuccess({
        effectId: effectIdValue,
        receipt: commentReceipt("Ship it"),
        expected: { state: "pending", claim },
        at,
      }),
      finalState: "succeeded",
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    const githubEffectId = effectId(1_100 + index);
    const first = await store.beginGitHubEffect({
      effectId: githubEffectId,
      source: source(),
      action: commentAudit("Ship it"),
      at: isoAt(300 + index * 10),
    });
    assert.equal(first.kind, "dispatch");

    const second = await store.beginGitHubEffect({
      effectId: githubEffectId,
      source: source(),
      action: commentAudit("Ship it"),
      at: isoAt(301 + index * 10),
    });
    assert.equal(second.kind, "reconcile");

    const third = await store.beginGitHubEffect({
      effectId: githubEffectId,
      source: source(),
      action: commentAudit("Ship it"),
      at: isoAt(302 + index * 10),
    });
    assert.equal(third.kind, "reconcile");
    assert.equal(third.claim.generation, second.claim.generation + 1);

    const [staleSettled, currentSettled] = await Promise.all([
      scenario.stale(githubEffectId, second.claim, isoAt(303 + index * 10)),
      scenario.current(githubEffectId, third.claim, isoAt(304 + index * 10)),
    ]);

    assert.equal(staleSettled, false, `${scenario.name} must fail closed once a newer reconciler owns the claim`);
    assert.equal(currentSettled, true, `${scenario.name} should still settle for the newest reconciler`);

    const persisted = await persistedEffect(githubEffectId);
    assert.equal(persisted.state, scenario.finalState);
    assert.equal(persisted.claim, null);
  }
});

test("persisted stores reject duplicate effect ids without rewriting the file", async () => {
    const first = pendingRecord(1_200);
    const second = succeededRecordForVariant("comment", 1_201);
    second.effectId = first.effectId;
    await seedEffects([first, second]);

    const before = await persistedStoreRaw();
    await assert.rejects(
      store.beginGitHubEffect({
        effectId: first.effectId,
        source: source(),
        action: first.action,
      }),
      /GitHub effect store is invalid/,
    );
    const after = await persistedStoreRaw();
    assert.equal(after, before);
});

test("persisted pending records missing a current claim fail closed instead of being reclaimed", async () => {
    const record = pendingRecord(1_210);
    delete record.claim;
    await seedEffects([record]);

    const before = await persistedStoreRaw();
    await assert.rejects(
      store.beginGitHubEffect({
        effectId: record.effectId,
        source: source(),
        action: record.action,
      }),
      /GitHub effect store is invalid/,
    );
    const after = await persistedStoreRaw();
    assert.equal(after, before);
});

test("malformed persisted success records fail closed for every GitHub receipt variant", async () => {
    const tooLongBody = "x".repeat(2_049);
    const cases = [
    {
      name: "comment hash mismatch",
      build() {
        const record = succeededRecordForVariant("comment", 2_000);
        record.receipt.result.bodySha256 = "0".repeat(64);
        return record;
      },
    },
    {
      name: "comment body exceeds bound",
      build() {
        const record = succeededRecordForVariant("comment", 2_010);
        record.receipt.action.body = tooLongBody;
        record.receipt.action.bodyBytes = Buffer.byteLength(tooLongBody, "utf8");
        record.receipt.action.bodySha256 = sha256Hex(tooLongBody);
        delete record.receipt.action.bodyTruncated;
        return record;
      },
    },
    {
      name: "review missing required request_changes body",
      build() {
        const record = succeededRecordForVariant("review", 2_020);
        delete record.receipt.action.body;
        delete record.receipt.action.bodyBytes;
        delete record.receipt.action.bodySha256;
        delete record.receipt.action.bodyTruncated;
        return record;
      },
    },
    {
      name: "review result state mismatches event",
      build() {
        const record = succeededRecordForVariant("review", 2_030);
        record.receipt.result.state = "APPROVED";
        return record;
      },
    },
    {
      name: "merge unexpected result key",
      build() {
        const record = succeededRecordForVariant("merge", 2_040);
        record.receipt.result.extra = true;
        return record;
      },
    },
    {
      name: "merge receipt action mismatches effect identity",
      build() {
        const record = succeededRecordForVariant("merge", 2_050);
        record.receipt.action.repo = "OpenCoven/other-repo";
        return record;
      },
    },
    {
      name: "rerun accepted must stay true",
      build() {
        const record = succeededRecordForVariant("rerun", 2_060);
        record.receipt.result.accepted = false;
        return record;
      },
    },
    {
      name: "dispatch workflow must match the reserved effect",
      build() {
        const record = succeededRecordForVariant("dispatch", 2_070);
        record.receipt.action.workflow = "deploy.yml";
        return record;
      },
    },
  ];

  for (const scenario of cases) {
    const record = scenario.build();
    await seedEffects([record]);
    const before = await persistedStoreRaw();
    await assert.rejects(
      store.beginGitHubEffect({
        effectId: record.effectId,
        source: source(),
        action: record.action,
      }),
      /GitHub effect store is invalid/,
      scenario.name,
    );
    const after = await persistedStoreRaw();
    assert.equal(after, before, `${scenario.name} must fail closed without rewriting the tampered record`);
  }
});
