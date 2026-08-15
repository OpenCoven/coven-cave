import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_CAPABILITIES,
  CLIENT_V1_ERROR_CODES,
  CLIENT_V1_LIMITS,
  CLIENT_V1_MIN_CLIENT_VERSION,
  CLIENT_V1_SCOPES,
  createClientV1ContractFixture,
  parseClientV1Cursor,
  parseClientV1IdempotencyKey,
  parseClientV1Identity,
  parseClientV1PairingScopes,
  parseClientV1Revision,
  renderClientV1ContractFixture,
  sortClientV1JsonKeys,
} from "./contract.ts";
import {
  clientV1Error,
  clientV1ErrorResponse,
  clientV1OperationInProgressError,
  clientV1Success,
  clientV1SuccessResponse,
  httpStatusForClientV1ErrorCode,
} from "./responses.ts";

test("publishes the locked v1 metadata, capabilities, scopes, and error codes", () => {
  assert.equal(CLIENT_V1_API_VERSION, "1.0");
  assert.equal(CLIENT_V1_MIN_CLIENT_VERSION, "0.1.0");
  assert.deepEqual(CLIENT_V1_CAPABILITIES, [
    "pairing",
    "credentials",
    "familiars",
    "projects",
    "conversations",
    "conversation-messages",
    "streaming",
    "cursors",
    "revisions",
  ]);
  assert.deepEqual(CLIENT_V1_SCOPES, [
    "chat:read",
    "chat:write",
    "conversations:write",
    "attachments:write",
    "tasks:write",
    "github:write",
  ]);
  assert.deepEqual(CLIENT_V1_ERROR_CODES, [
    "invalid_request",
    "unauthorized",
    "scope_denied",
    "not_found",
    "conflict",
    "rate_limited",
    "pairing_pending",
    "pairing_denied",
    "pairing_expired",
    "incompatible_version",
    "service_unavailable",
    "reconcile_required",
    "internal_error",
  ]);
});

test("publishes stable client v1 limits", () => {
  assert.deepEqual(CLIENT_V1_LIMITS, {
    idempotencyKeyCharacters: 36,
    requestIdCharacters: 64,
    revisionTokenCharacters: 128,
    cursorCharacters: 512,
    errorMessageCharacters: 256,
    errorDetailEntries: 16,
    errorDetailValueCharacters: 256,
    defaultPageSize: 50,
    maxPageSize: 100,
  });
});

test("parses stable ids, scopes, identities, revisions, and cursors", () => {
  assert.equal(
    parseClientV1IdempotencyKey("f47ac10b-58cc-4372-a567-0e02b2c3d479"),
    "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  );
  assert.equal(
    parseClientV1IdempotencyKey("019535d9-7b9a-7b9d-8b42-0ca7d836c2a3"),
    "019535d9-7b9a-7b9d-8b42-0ca7d836c2a3",
  );
  assert.throws(() => parseClientV1IdempotencyKey("not-a-uuid"), /idempotency key/i);

  assert.deepEqual(
    parseClientV1PairingScopes(["chat:read", "conversations:write"]),
    ["chat:read", "conversations:write"],
  );
  assert.throws(() => parseClientV1PairingScopes(["admin"]), /scope/i);

  assert.deepEqual(
    parseClientV1Identity({
      kind: "conversation",
      id: "conversation-1",
      displayName: "Example conversation",
    }),
    {
      kind: "conversation",
      id: "conversation-1",
      displayName: "Example conversation",
    },
  );
  assert.throws(() => parseClientV1Identity({ kind: "admin", id: "conversation-1" }), /identity kind/i);

  assert.deepEqual(
    parseClientV1Revision({
      token: "revision-1",
      updatedAt: "2026-08-15T00:00:00.000Z",
    }),
    {
      token: "revision-1",
      updatedAt: "2026-08-15T00:00:00.000Z",
    },
  );
  assert.throws(() => parseClientV1Revision({ token: "", updatedAt: "2026-08-15T00:00:00.000Z" }), /revision token/i);

  assert.deepEqual(
    parseClientV1Cursor({
      current: "cursor-1",
      next: "cursor-2",
      hasMore: true,
    }),
    {
      current: "cursor-1",
      next: "cursor-2",
      hasMore: true,
    },
  );
  assert.throws(() => parseClientV1Cursor({ hasMore: true }), /cursor/i);
});

test("serializes the public contract deterministically by sorting object keys", () => {
  assert.deepEqual(
    sortClientV1JsonKeys({
      z: 1,
      nested: { b: 2, a: 1 },
      array: [{ b: 2, a: 1 }, 3],
    }),
    {
      array: [{ a: 1, b: 2 }, 3],
      nested: { a: 1, b: 2 },
      z: 1,
    },
  );

  const fixture = createClientV1ContractFixture();
  assert.equal(
    renderClientV1ContractFixture(),
    `${JSON.stringify(sortClientV1JsonKeys(fixture), null, 2)}\n`,
  );
});

test("builds explicit success envelopes with stable contract metadata", () => {
  assert.deepEqual(
    clientV1Success(
      { status: "ok" },
      {
        capabilities: ["conversations", "streaming"],
        requestId: "request-1",
        identity: { kind: "conversation", id: "conversation-1" },
        revision: { token: "revision-1", updatedAt: "2026-08-15T00:00:00.000Z" },
        cursor: { current: "cursor-1", next: "cursor-2", hasMore: true },
      },
    ),
    {
      apiVersion: "1.0",
      minimumClientVersion: "0.1.0",
      capabilities: ["conversations", "streaming"],
      requestId: "request-1",
      identity: { kind: "conversation", id: "conversation-1" },
      revision: { token: "revision-1", updatedAt: "2026-08-15T00:00:00.000Z" },
      cursor: { current: "cursor-1", next: "cursor-2", hasMore: true },
      data: { status: "ok" },
    },
  );
});

test("maps explicit client v1 errors without masking failures as success", async () => {
  assert.equal(httpStatusForClientV1ErrorCode("invalid_request"), 400);
  assert.equal(httpStatusForClientV1ErrorCode("pairing_expired"), 410);
  assert.equal(httpStatusForClientV1ErrorCode("incompatible_version"), 426);
  assert.equal(httpStatusForClientV1ErrorCode("service_unavailable"), 503);

  assert.deepEqual(
    clientV1Error("rate_limited", "Please retry later.", {
      details: { retryAfterMs: "1000" },
      retryable: true,
    }),
    {
      apiVersion: "1.0",
      minimumClientVersion: "0.1.0",
      capabilities: [...CLIENT_V1_CAPABILITIES],
      error: {
        code: "rate_limited",
        message: "Please retry later.",
        details: { retryAfterMs: "1000" },
        retryable: true,
      },
    },
  );

  const accepted = clientV1SuccessResponse(
    { status: "ok" },
    { capabilities: ["pairing"], status: 202 },
  );
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: ["pairing"],
    data: { status: "ok" },
  });

  const limited = clientV1ErrorResponse("rate_limited", "Please retry later.", {
    details: { retryAfterMs: "1000" },
    retryable: true,
  });
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: [...CLIENT_V1_CAPABILITIES],
    error: {
      code: "rate_limited",
      message: "Please retry later.",
      details: { retryAfterMs: "1000" },
      retryable: true,
    },
  });

  assert.throws(
    () => clientV1SuccessResponse({ status: "ok" }, { status: 500 }),
    /2xx/i,
  );
  assert.throws(
    () => clientV1ErrorResponse("invalid_request", "bad request", { status: 200 }),
    /4xx or 5xx/i,
  );
});

test("represents in-progress operations as retryable conflicts", () => {
  assert.deepEqual(clientV1OperationInProgressError("send-message"), {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: [...CLIENT_V1_CAPABILITIES],
    error: {
      code: "conflict",
      message: "The operation is already in progress.",
      details: {
        operation: "send-message",
        reason: "operation_in_progress",
      },
      retryable: true,
    },
  });
});

test("builds a deterministic public contract fixture with shared metadata and examples", () => {
  const fixture = createClientV1ContractFixture();

  assert.deepEqual(fixture.contract, {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: [...CLIENT_V1_CAPABILITIES],
    pairingScopes: [...CLIENT_V1_SCOPES],
    errorCodes: [...CLIENT_V1_ERROR_CODES],
    limits: CLIENT_V1_LIMITS,
  });
  assert.equal(fixture.examples.health.minimumClientVersion, "0.1.0");
  assert.equal(fixture.examples.health.capabilities.includes("pairing"), true);
  assert.deepEqual(fixture.examples.credential.identity, {
    kind: "credential",
    id: "credential-example",
    displayName: "Example companion",
  });
  assert.deepEqual(fixture.examples.conversationList.cursor, {
    current: "conversation-list:cursor:0",
    next: "conversation-list:cursor:1",
    hasMore: true,
  });
  assert.deepEqual(fixture.examples.conversationDetail.revision, {
    token: "conversation-example-revision-1",
    updatedAt: "2026-08-15T00:00:01.000Z",
  });
  assert.deepEqual(fixture.examples.streamEvent.cursor, {
    current: "conversation-example:stream:1",
    next: "conversation-example:stream:2",
    hasMore: true,
  });
  assert.deepEqual(createClientV1ContractFixture(), fixture);
});
