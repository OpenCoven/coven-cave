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
  parseClientV1ConversationDetailResponse,
  parseClientV1ConversationListResponse,
  parseClientV1CredentialResponse,
  parseClientV1Cursor,
  parseClientV1ErrorEnvelope,
  parseClientV1FamiliarResponse,
  parseClientV1HealthResponse,
  parseClientV1IdempotencyKey,
  parseClientV1Identity,
  parseClientV1PairingScopes,
  parseClientV1ProjectResponse,
  parseClientV1PublicSuccessResponse,
  parseClientV1Revision,
  parseClientV1StreamEvent,
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

test("accepts only unambiguous public wire timestamps", () => {
  const fixture = createClientV1ContractFixture();
  const canonicalTimestamp = fixture.examples.conversationDetail.revision?.updatedAt;

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

test("accepts only JSON-safe additive public values", () => {
  const fixture = createClientV1ContractFixture();
  const nestedExtension = {
    nested: [null, true, 3.5, "extension", { child: "accepted" }],
  };
  const response = {
    ...fixture.examples.health,
    extension: nestedExtension,
    data: { ...fixture.examples.health.data, extension: nestedExtension },
    cursor: {
      current: "cursor-1",
      hasMore: true,
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
  ]) {
    assert.throws(
      () => parseClientV1SuccessEnvelope({ ...fixture.examples.health, extension: value }),
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

test("parses complete public envelopes while preserving additive fields", () => {
  const fixture = createClientV1ContractFixture();
  const success = {
    ...fixture.examples.health,
    extension: "accepted",
    data: { ...fixture.examples.health.data, extension: "accepted" },
  };
  const error = {
    ...fixture.examples.error,
    extension: "accepted",
    error: { ...fixture.examples.error.error, extension: "accepted" },
  };

  assert.deepEqual(parseClientV1SuccessEnvelope(success), success);
  assert.deepEqual(parseClientV1ErrorEnvelope(error), error);
  assert.throws(
    () => parseClientV1SuccessEnvelope({ data: { status: "ok" } }),
    /apiVersion/i,
  );
  assert.throws(
    () => parseClientV1ErrorEnvelope({ ...fixture.examples.error, error: {} }),
    /error code/i,
  );
  assert.throws(
    () => parseClientV1SuccessEnvelope({ ...fixture.examples.health, error: fixture.examples.error.error }),
    /must not contain an error/i,
  );
  assert.throws(
    () => parseClientV1ErrorEnvelope({ ...fixture.examples.error, data: fixture.examples.health.data }),
    /must not contain data/i,
  );
});

test("parses concrete public responses with additions and rejects missing fields", () => {
  const fixture = createClientV1ContractFixture();
  const cases: Array<{
    response: Record<string, unknown>;
    parse(value: unknown): unknown;
    missing: Record<string, unknown>;
  }> = [
    {
      response: fixture.examples.health,
      parse: parseClientV1HealthResponse,
      missing: { ...fixture.examples.health, data: {} },
    },
    {
      response: fixture.examples.credential,
      parse: parseClientV1CredentialResponse,
      missing: {
        ...fixture.examples.credential,
        data: { scopes: ["chat:read"], expiresAt: null },
      },
    },
    {
      response: fixture.examples.familiar,
      parse: parseClientV1FamiliarResponse,
      missing: { ...fixture.examples.familiar, data: {} },
    },
    {
      response: fixture.examples.project,
      parse: parseClientV1ProjectResponse,
      missing: { ...fixture.examples.project, data: {} },
    },
    {
      response: fixture.examples.conversationList,
      parse: parseClientV1ConversationListResponse,
      missing: { ...fixture.examples.conversationList, data: {} },
    },
    {
      response: fixture.examples.conversationDetail,
      parse: parseClientV1ConversationDetailResponse,
      missing: { ...fixture.examples.conversationDetail, data: {} },
    },
  ];

  for (const { response, parse, missing } of cases) {
    const additive = {
      ...response,
      extension: "accepted",
      data: { ...(response.data as Record<string, unknown>), extension: "accepted" },
    };
    assert.deepEqual(parse(additive), additive);
    assert.throws(() => parse(missing));
  }

  const streamEvent = {
    ...fixture.examples.streamEvent,
    extension: "accepted",
    data: { ...fixture.examples.streamEvent.data, extension: "accepted" },
  };
  assert.deepEqual(parseClientV1StreamEvent(streamEvent), streamEvent);
  assert.throws(
    () => parseClientV1StreamEvent({ data: {} }),
    /stream event/i,
  );
});

test("recognizes complete success shapes without misclassifying additions", () => {
  const fixture = createClientV1ContractFixture();
  const conversationDetail = {
    ...fixture.examples.conversationDetail,
    data: {
      ...fixture.examples.conversationDetail.data,
      label: "extension",
    },
  };

  assert.deepEqual(
    parseClientV1PublicSuccessResponse(conversationDetail),
    conversationDetail,
  );
  assert.deepEqual(
    clientV1Success(conversationDetail.data).data,
    conversationDetail.data,
  );

  const { identity: _identity, ...conversationDetailWithoutIdentity } = conversationDetail;
  const ambiguous = {
    ...conversationDetailWithoutIdentity,
    data: {
      ...conversationDetail.data,
      scopes: ["chat:read"],
      expiresAt: null,
    },
  };
  assert.throws(
    () => parseClientV1PublicSuccessResponse(ambiguous),
    /ambiguous/i,
  );
  assert.throws(
    () => clientV1Success(ambiguous.data),
    /ambiguous/i,
  );
});

test("rejects conflicting health and credential shapes", () => {
  const fixture = createClientV1ContractFixture();
  const credentialWithHealthStatus = {
    ...fixture.examples.credential,
    data: {
      ...fixture.examples.credential.data,
      status: "ok",
    },
  };

  assert.throws(
    () => parseClientV1PublicSuccessResponse(credentialWithHealthStatus),
    /ambiguous/i,
  );
  assert.throws(
    () => clientV1Success(credentialWithHealthStatus.data),
    /ambiguous/i,
  );
});

test("uses the complete conversation-list shape despite unrelated identity metadata", () => {
  const fixture = createClientV1ContractFixture();
  const identity = { kind: "project" as const, id: "project-1" };
  const conversationList = {
    ...fixture.examples.conversationList,
    identity,
  };

  assert.deepEqual(
    parseClientV1PublicSuccessResponse(conversationList),
    conversationList,
  );
  assert.deepEqual(
    clientV1Success(conversationList.data, { identity }).data,
    conversationList.data,
  );
});

test("rejects incomplete concrete success data before producing responses", () => {
  assert.throws(
    () => clientV1Success({}),
    /public success response data/i,
  );
  assert.throws(
    () => clientV1SuccessResponse({}),
    /public success response data/i,
  );
});
