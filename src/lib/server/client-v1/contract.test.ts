import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_CAPABILITIES,
  CLIENT_V1_ERROR_CODES,
  CLIENT_V1_IDENTITY_KINDS,
  CLIENT_V1_LIMITS,
  CLIENT_V1_MIN_CLIENT_VERSION,
  CLIENT_V1_SCOPES,
  createClientV1ContractFixture,
  parseClientV1Cursor,
  parseClientV1ErrorEnvelope,
  parseClientV1IdempotencyKey,
  parseClientV1Identity,
  parseClientV1PairingScopes,
  parseClientV1Revision,
  parseClientV1StatusRecord,
  parseClientV1SuccessEnvelope,
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

test("publishes the locked v1 metadata, capabilities, scopes, error codes, and identity kinds", () => {
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
  assert.deepEqual(CLIENT_V1_IDENTITY_KINDS, [
    "client",
    "credential",
    "familiar",
    "project",
    "conversation",
    "message",
    "event",
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

test("parses stable ids, scopes, identities, revisions, cursors, and status records", () => {
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

  assert.deepEqual(
    parseClientV1StatusRecord({ status: "ok", extension: "accepted" }),
    { status: "ok", extension: "accepted" },
  );
  assert.throws(() => parseClientV1StatusRecord({}), /status/i);
  assert.throws(() => parseClientV1StatusRecord({ status: "   " }), /status/i);
});

test("accepts only unambiguous public wire timestamps", () => {
  const fixture = createClientV1ContractFixture();
  const canonicalTimestamp = fixture.examples.revision.updatedAt;

  assert.deepEqual(
    parseClientV1Revision({ token: "revision-1", updatedAt: canonicalTimestamp }),
    { token: "revision-1", updatedAt: canonicalTimestamp },
  );
  for (const timestamp of ["2026-08-15", "August 15, 2026 00:00:00 UTC"]) {
    assert.throws(
      () => parseClientV1Revision({ token: "revision-1", updatedAt: timestamp }),
      /ISO-8601/i,
    );
  }
});

test("preserves additive cursor fields through parsers and response helpers", () => {
  const cursor = {
    current: "cursor-1",
    next: "cursor-2",
    hasMore: true,
    futureCursorField: "accepted",
  };

  assert.deepEqual(parseClientV1Cursor(cursor), cursor);
  assert.deepEqual(
    clientV1Success({ status: "ok" }, { cursor }).cursor,
    cursor,
  );
});

test("accepts only JSON-safe additive public values", async () => {
  const fixture = createClientV1ContractFixture();
  const nestedExtension = {
    nested: [null, true, 3.5, "extension", { child: "accepted" }],
  };
  const response = {
    ...fixture.examples.successEnvelope,
    extension: nestedExtension,
    data: { ...fixture.examples.successEnvelope.data, extension: nestedExtension },
    cursor: {
      ...fixture.examples.successEnvelope.cursor!,
      extension: nestedExtension,
    },
  };

  const parsed = parseClientV1SuccessEnvelope(response);
  assert.deepEqual(parsed, response);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), parsed);
  assert.deepEqual(
    parseClientV1Cursor(response.cursor),
    response.cursor,
  );
  assert.deepEqual(
    clientV1Success({ status: "ok", extension: nestedExtension }).data,
    { status: "ok", extension: nestedExtension },
  );
  const ordinaryArray = ["extension", { nested: true }];
  assert.deepEqual(
    parseClientV1SuccessEnvelope({ ...fixture.examples.successEnvelope, extension: ordinaryArray }),
    { ...fixture.examples.successEnvelope, extension: ordinaryArray },
  );
  const helper = clientV1Success({ status: "ok", extension: ordinaryArray });
  const helperResponse = clientV1SuccessResponse({ status: "ok", extension: ordinaryArray });
  assert.deepEqual(await helperResponse.json(), helper);
  assert.equal(Object.is(-0, JSON.parse(JSON.stringify(-0))), false);

  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const value of [
    BigInt(1),
    new Date("2026-08-15T00:00:00.000Z"),
    new (class Extension {
      value = "extension";
    })(),
    NaN,
    Infinity,
    -Infinity,
    () => undefined,
    Symbol("extension"),
    undefined,
    cycle,
    -0,
  ]) {
    assert.throws(
      () => parseClientV1SuccessEnvelope({ ...fixture.examples.successEnvelope, extension: value }),
      /JSON-safe/i,
    );
  }
  assert.throws(
    () => parseClientV1Cursor({ current: "cursor-1", hasMore: true, extension: BigInt(1) }),
    /JSON-safe/i,
  );
  assert.throws(
    () => clientV1SuccessResponse({ status: "ok", extension: BigInt(1) } as never),
    /JSON-safe/i,
  );
});

test("rejects custom array prototypes from public additions", () => {
  const fixture = createClientV1ContractFixture();
  class FancyArray extends Array<string> {}

  assert.throws(
    () => parseClientV1SuccessEnvelope({
      ...fixture.examples.successEnvelope,
      extension: new FancyArray("extension"),
    }),
    /JSON-safe/i,
  );
  assert.deepEqual(
    parseClientV1SuccessEnvelope({
      ...fixture.examples.successEnvelope,
      extension: ["extension", { nested: true }],
    }).extension,
    ["extension", { nested: true }],
  );
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

test("builds explicit generic success envelopes with stable contract metadata", () => {
  assert.deepEqual(
    clientV1Success(
      { status: "ok", label: "foundation" },
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
      data: { status: "ok", label: "foundation" },
    },
  );
});

test("maps explicit client v1 errors without coupling success to route guesses", async () => {
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
    { contract: "foundation-only" },
    { capabilities: ["pairing"], status: 202 },
  );
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: ["pairing"],
    data: { contract: "foundation-only" },
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
  for (const status of [204, 205]) {
    assert.throws(
      () => clientV1SuccessResponse({ status: "ok" }, { status }),
      /must not use a bodyless status/i,
    );
  }
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

test("builds a deterministic foundation-only contract fixture with shared primitives", () => {
  const fixture = createClientV1ContractFixture();

  assert.deepEqual(fixture.contract, {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: [...CLIENT_V1_CAPABILITIES],
    pairingScopes: [...CLIENT_V1_SCOPES],
    identityKinds: [...CLIENT_V1_IDENTITY_KINDS],
    errorCodes: [...CLIENT_V1_ERROR_CODES],
    limits: CLIENT_V1_LIMITS,
  });
  assert.deepEqual(fixture.examples.status, { status: "ok" });
  assert.deepEqual(fixture.examples.identity, {
    kind: "conversation",
    id: "conversation-example",
    displayName: "Example conversation",
  });
  assert.deepEqual(fixture.examples.revision, {
    token: "conversation-example-revision-1",
    updatedAt: "2026-08-15T00:00:01.000Z",
  });
  assert.deepEqual(fixture.examples.cursor, {
    current: "conversation-list:cursor:0",
    next: "conversation-list:cursor:1",
    hasMore: true,
  });
  assert.equal(fixture.examples.successEnvelope.minimumClientVersion, "0.1.0");
  assert.equal(fixture.examples.successEnvelope.capabilities.includes("pairing"), true);
  assert.deepEqual(fixture.examples.successEnvelope.identity, fixture.examples.identity);
  assert.deepEqual(fixture.examples.successEnvelope.revision, fixture.examples.revision);
  assert.deepEqual(fixture.examples.successEnvelope.cursor, fixture.examples.cursor);
  assert.deepEqual(fixture.examples.successEnvelope.data, fixture.examples.status);
  assert.deepEqual(fixture.examples.errorEnvelope.error, {
    code: "reconcile_required",
    message: "Client state must be reconciled.",
    details: { reason: "resume_from_canonical_state" },
    retryable: true,
  });
  assert.deepEqual(createClientV1ContractFixture(), fixture);
});

test("parses complete public envelopes while preserving additive fields", () => {
  const fixture = createClientV1ContractFixture();
  const success = {
    ...fixture.examples.successEnvelope,
    extension: "accepted",
    data: { ...fixture.examples.successEnvelope.data, extension: "accepted" },
  };
  const error = {
    ...fixture.examples.errorEnvelope,
    extension: "accepted",
    error: { ...fixture.examples.errorEnvelope.error, extension: "accepted" },
  };

  assert.deepEqual(parseClientV1SuccessEnvelope(success), success);
  assert.deepEqual(parseClientV1ErrorEnvelope(error), error);
  assert.throws(
    () => parseClientV1SuccessEnvelope({ data: { status: "ok" } }),
    /apiVersion/i,
  );
  assert.throws(
    () => parseClientV1ErrorEnvelope({ ...fixture.examples.errorEnvelope, error: {} }),
    /error code/i,
  );
  assert.throws(
    () => parseClientV1SuccessEnvelope({ ...fixture.examples.successEnvelope, error: fixture.examples.errorEnvelope.error }),
    /must not contain an error/i,
  );
  assert.throws(
    () => parseClientV1ErrorEnvelope({ ...fixture.examples.errorEnvelope, data: fixture.examples.successEnvelope.data }),
    /must not contain data/i,
  );
});

test("validates foundation primitives independently of future routes", () => {
  const fixture = createClientV1ContractFixture();
  const identity = { ...fixture.examples.identity, extension: "accepted" };
  const revision = { ...fixture.examples.revision, extension: "accepted" };
  const cursor = { ...fixture.examples.cursor, extension: "accepted" };
  const status = { ...fixture.examples.status, extension: "accepted" };

  assert.deepEqual(parseClientV1Identity(identity), identity);
  assert.deepEqual(parseClientV1Revision(revision), revision);
  assert.deepEqual(parseClientV1Cursor(cursor), cursor);
  assert.deepEqual(parseClientV1StatusRecord(status), status);
});

test("uses explicit generic success envelopes instead of guessing future route payloads", async () => {
  const fixture = createClientV1ContractFixture();
  const futureRouteLike = {
    status: "ok",
    label: "Example companion",
    scopes: ["chat:read"],
    expiresAt: null,
    name: "Example project",
    conversations: [],
    messages: [],
    familiar: { kind: "familiar", id: "familiar-example" },
  };

  const genericEnvelope = clientV1Success(futureRouteLike);
  assert.deepEqual(genericEnvelope.data, futureRouteLike);
  assert.deepEqual(
    parseClientV1SuccessEnvelope({ ...fixture.examples.successEnvelope, data: futureRouteLike }).data,
    futureRouteLike,
  );

  const genericResponse = clientV1SuccessResponse(futureRouteLike, { status: 202 });
  assert.equal(genericResponse.status, 202);
  assert.deepEqual(await genericResponse.json(), {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: [...CLIENT_V1_CAPABILITIES],
    data: futureRouteLike,
  });

  const emptyEnvelope = clientV1Success({});
  assert.deepEqual(emptyEnvelope.data, {});
  const emptyResponse = clientV1SuccessResponse({});
  assert.deepEqual(await emptyResponse.json(), {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: [...CLIENT_V1_CAPABILITIES],
    data: {},
  });
});
