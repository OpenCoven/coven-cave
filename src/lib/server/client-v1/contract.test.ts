import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageVersion: string = JSON.parse(
  readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
).version;

import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_CAPABILITIES,
  CLIENT_V1_DISCOVERY_CONTRACT,
  CLIENT_V1_ERROR_CODES,
  CLIENT_V1_IDENTITY_KINDS,
  CLIENT_V1_LIMITS,
  CLIENT_V1_MIN_CLIENT_VERSION,
  CLIENT_V1_OPERATIONS,
  CLIENT_V1_PAIRING_SECRET_HEADER,
  CLIENT_V1_PUBLIC_ROUTES,
  CLIENT_V1_SCOPES,
  createClientV1ContractFixture,
  parseClientV1AdvertisedCapabilities,
  parseClientV1AdvertisedOperations,
  parseClientV1Capabilities,
  parseClientV1Operations,
  parseClientV1Cursor,
  parseClientV1ErrorEnvelope,
  parseClientV1Health,
  parseClientV1IdempotencyKey,
  parseClientV1Identity,
  type ClientV1Record,
  parseClientV1PairingScopes,
  parseClientV1PairingCreateRequest,
  parseClientV1Revision,
  parseClientV1StatusRecord,
  parseClientV1SuccessEnvelope,
  renderClientV1ContractFixture,
  sortClientV1JsonKeys,
  type ClientV1Cursor,
  type ClientV1ErrorEnvelope,
  type ClientV1Identity,
  type ClientV1Revision,
  type ClientV1StatusRecord,
  type ClientV1SuccessEnvelope,
} from "./contract.ts";
import { clientV1OperationRecords } from "./operations.ts";
import {
  clientV1Error,
  clientV1ErrorResponse,
  clientV1OperationInProgressError,
  clientV1RateLimitResponse,
  clientV1Success,
  clientV1SuccessResponse,
  httpStatusForClientV1ErrorCode,
} from "./responses.ts";

// Type-only compile-time assertions: the public envelope types must form a
// precise discriminated union. Without `error?: never` / `data?: never`,
// ClientV1Record's string index signature would let `error` and `data`
// type-check on either envelope, so `Equal` here would resolve to `false` and
// `Assert` would fail to compile.
type Equal<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2)
    ? (<Value>() => Value extends Expected ? 1 : 2) extends
      (<Value>() => Value extends Actual ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;

export type ClientV1SuccessEnvelopeExcludesErrorIsExact = Assert<
  Equal<ClientV1SuccessEnvelope<ClientV1StatusRecord>["error"], undefined>
>;
export type ClientV1ErrorEnvelopeExcludesDataIsExact = Assert<
  Equal<ClientV1ErrorEnvelope["data"], undefined>
>;

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

test("publishes the locked v1 metadata, capabilities, scopes, error codes, and identity kinds", () => {
  assert.equal(CLIENT_V1_API_VERSION, "1.0");
  assert.equal(CLIENT_V1_MIN_CLIENT_VERSION, "0.1.0");
  // Every entry here is a family some live operation claims, and every
  // operation is bound to a route on disk by api-contracts.test.ts. `streaming`
  // and `revisions` were removed by #4869: both were advertised for months with
  // no route that could serve either, so `supports("streaming")` was a false
  // operational claim. Neither was ever live, so removing them withdraws
  // nothing a client could have invoked — see the migration note in
  // docs/api/client-v1.md.
  assert.deepEqual(CLIENT_V1_CAPABILITIES, [
    "health",
    "pairing",
    "credentials",
    "familiars",
    "projects",
    "conversations",
    "conversation-messages",
    "cursors",
  ]);
  assert.deepEqual(CLIENT_V1_OPERATIONS, [
    "health.read",
    "pairing.create",
    "pairing.poll",
    "pairing.exchange",
    "pairing.admin.list",
    "pairing.admin.decide",
    "credentials.admin.list",
    "credentials.admin.revoke",
    "familiars.list",
    "projects.list",
    "conversations.list",
    "conversations.read",
    "messages.list",
  ]);
  for (const retired of ["streaming", "revisions"]) {
    assert.equal(
      (CLIENT_V1_CAPABILITIES as readonly string[]).includes(retired),
      false,
      `${retired} has no owning route and must not be declared live`,
    );
    assert.equal(
      (CLIENT_V1_OPERATIONS as readonly string[]).some((id) => id.startsWith(`${retired}.`)),
      false,
      `${retired} has no owning route and must not appear as an operation`,
    );
  }
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

test("publishes the reviewed public bootstrap routes and pairing secret header", () => {
  assert.equal(CLIENT_V1_PAIRING_SECRET_HEADER, "x-coven-pairing-secret");
  assert.deepEqual(CLIENT_V1_PUBLIC_ROUTES, [
    { method: "GET", path: "/api/client/v1/health" },
    { method: "POST", path: "/api/client/v1/pairing/requests" },
    { method: "GET", path: "/api/client/v1/pairing/requests/:id" },
    { method: "POST", path: "/api/client/v1/pairing/requests/:id/exchange" },
  ]);
  assert.equal(Object.isFrozen(CLIENT_V1_PUBLIC_ROUTES), true);
  for (const route of CLIENT_V1_PUBLIC_ROUTES) {
    assert.equal(Object.isFrozen(route), true);
  }
});

test("keeps the manifest's operation records in step with the wire ids", () => {
  // Two artifacts describe the same inventory at two levels of detail: the
  // envelope carries ids (it rides every response) and the fixture manifest
  // carries whole records (a client vendors it once). If they could disagree,
  // an SDK resolving an advertised id against the vendored manifest would find
  // nothing — the exact "probe an arbitrary path to find out" failure the
  // inventory exists to remove.
  const records = createClientV1ContractFixture().contract.operations;
  assert.deepEqual(records.map((record) => record.id), [...CLIENT_V1_OPERATIONS]);
  for (const record of records) {
    assert.equal(typeof record.method, "string");
    assert.ok(record.path.startsWith("/api/client/v1/"), record.path);
    assert.ok(["public", "admin", "authenticated"].includes(record.ingress), record.ingress);
    assert.ok(record.families.length > 0, `${record.id} names no capability family`);
    for (const family of record.families) {
      assert.ok(
        (CLIENT_V1_CAPABILITIES as readonly string[]).includes(family),
        `${record.id} claims family ${family}, which is not advertised`,
      );
    }
    // The authority class is legible from the id alone, so a client that only
    // ever sees the envelope can still tell that a `.admin.` operation is not
    // something its bearer will ever satisfy.
    assert.equal(record.id.includes(".admin."), record.ingress === "admin", record.id);
    assert.equal(record.scope === null, record.ingress !== "authenticated", record.id);
  }
  // Every advertised family is claimed by at least one record. The converse of
  // the per-record check above, and the one that catches a family surviving in
  // the list after the operation that justified it is gone.
  const claimed = new Set(records.flatMap((record) => record.families));
  assert.deepEqual(
    (CLIENT_V1_CAPABILITIES as readonly string[]).filter((family) => !claimed.has(family)),
    [],
  );
});

test("validates the operation inventory strictly on the producer side", () => {
  assert.deepEqual(parseClientV1Operations([...CLIENT_V1_OPERATIONS]), [...CLIENT_V1_OPERATIONS]);
  assert.deepEqual(parseClientV1Operations(["health.read"]), ["health.read"]);
  // Cave is the producer: it must refuse to export an id no reviewed record
  // backs, which is the whole reason `streaming` could be advertised for months.
  assert.throws(() => parseClientV1Operations(["streaming.subscribe"]), /operations entry is not supported/);
  assert.throws(() => parseClientV1Operations(["health.read", "health.read"]), /duplicates/);
  assert.throws(() => parseClientV1Operations([]), /non-empty/);
  assert.throws(() => parseClientV1Operations("health.read"), /non-empty array/);
  assert.throws(() => parseClientV1Capabilities(["streaming"]), /capabilities entry is not supported/);
});

test("keeps consumers additive-tolerant where the producer is strict", () => {
  // The producer and consumer rules are deliberately different. A newer
  // compatible Cave may advertise ids an older SDK has never heard of; if that
  // SDK refused the envelope, every additive minor release would become a
  // breaking one. So the consumer parsers validate shape and PRESERVE unknown
  // ids rather than rejecting them.
  assert.deepEqual(
    parseClientV1AdvertisedOperations(["conversations.list", "messages.stream", "runs.cancel"]),
    ["conversations.list", "messages.stream", "runs.cancel"],
  );
  assert.deepEqual(
    parseClientV1AdvertisedCapabilities(["conversations", "attachments", "conversation-messages"]),
    ["conversations", "attachments", "conversation-messages"],
  );
  // Tolerant is not credulous. Shape is still enforced, and "unknown" may not
  // mean "unbounded" — a consumer that accepts anything is a consumer an
  // untrusted producer can allocate against.
  assert.throws(() => parseClientV1AdvertisedOperations([]), /non-empty/);
  assert.throws(() => parseClientV1AdvertisedOperations(["Conversations.List"]), /malformed/);
  assert.throws(() => parseClientV1AdvertisedOperations(["conversations list"]), /malformed/);
  assert.throws(() => parseClientV1AdvertisedOperations([""]), /malformed/);
  assert.throws(() => parseClientV1AdvertisedOperations([42]), /malformed/);
  assert.throws(() => parseClientV1AdvertisedCapabilities(["a".repeat(65)]), /malformed/);
  assert.throws(
    () => parseClientV1AdvertisedCapabilities(["conversations", "conversations"]),
    /duplicates/,
  );
  // And the rule the tolerance must not be read as: a consumer preserves an id
  // it does not understand, it never claims support for it. Asserted here on
  // the only thing this module can assert it against — the closed producer set,
  // which is what a `supports()` implementation narrows against.
  const advertised = parseClientV1AdvertisedOperations(["conversations.list", "messages.stream"]);
  const understood = advertised.filter((id) => (CLIENT_V1_OPERATIONS as readonly string[]).includes(id));
  assert.deepEqual(understood, ["conversations.list"]);
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
    instanceIdCharacters: 64,
    releaseVersionCharacters: 64,
    declarationIdCharacters: 64,
  });
});

test("accepts a health record carrying the required release metadata", () => {
  const health = parseClientV1Health({
    instanceId: "6f1d2c94-1f0b-4d3e-8a77-6b6f2a4c9d10",
    pairingRequired: true,
    releaseVersion: "0.3.6",
  });
  assert.equal(health.instanceId, "6f1d2c94-1f0b-4d3e-8a77-6b6f2a4c9d10");
  assert.equal(health.pairingRequired, true);
  assert.equal(health.releaseVersion, "0.3.6");
});

test("refuses health records missing or weakening required release metadata", () => {
  const valid = {
    instanceId: "6f1d2c94-1f0b-4d3e-8a77-6b6f2a4c9d10",
    pairingRequired: true,
    releaseVersion: "0.3.6",
  };

  for (const field of ["instanceId", "releaseVersion"] as const) {
    const missing: Record<string, unknown> = { ...valid };
    delete missing[field];
    assert.throws(() => parseClientV1Health(missing), new RegExp(field));
    assert.throws(() => parseClientV1Health({ ...valid, [field]: "" }), new RegExp(field));
    assert.throws(() => parseClientV1Health({ ...valid, [field]: "  " }), new RegExp(field));
  }

  // A client that reads pairingRequired:false would conclude it may skip
  // pairing entirely, so the parser must refuse it rather than pass it through.
  assert.throws(
    () => parseClientV1Health({ ...valid, pairingRequired: false }),
    /pairingRequired must be true/,
  );
  assert.throws(
    () => parseClientV1Health({ ...valid, instanceId: "x".repeat(CLIENT_V1_LIMITS.instanceIdCharacters + 1) }),
    /instanceId/,
  );
  assert.throws(
    () =>
      parseClientV1Health({
        ...valid,
        releaseVersion: "x".repeat(CLIENT_V1_LIMITS.releaseVersionCharacters + 1),
      }),
    /releaseVersion/,
  );
});

test("keeps the release version out of the contract fixture", () => {
  // The fixture is the file that proves the contract SHAPE did not change. If
  // it carried the running version, every release stamp would rewrite it and
  // the diff would stop meaning anything.
  const rendered = renderClientV1ContractFixture();
  assert.equal(rendered.includes(packageVersion), false);
  assert.equal(createClientV1ContractFixture().examples.health.releaseVersion, "0.0.0");
});

test("freezes exported protocol collections at runtime", () => {
  assert.equal(Object.isFrozen(CLIENT_V1_SCOPES), true);
  assert.equal(Object.isFrozen(CLIENT_V1_CAPABILITIES), true);
  assert.equal(Object.isFrozen(CLIENT_V1_OPERATIONS), true);
  assert.equal(Object.isFrozen(CLIENT_V1_ERROR_CODES), true);
  assert.equal(Object.isFrozen(CLIENT_V1_IDENTITY_KINDS), true);
  assert.equal(Object.isFrozen(CLIENT_V1_LIMITS), true);

  assert.throws(
    () => {
      (CLIENT_V1_CAPABILITIES as unknown as string[]).push("poisoned");
    },
    /TypeError|Cannot add property|object is not extensible/i,
  );
  assert.throws(
    () => {
      (CLIENT_V1_LIMITS as { maxPageSize: number }).maxPageSize = 1;
    },
    /TypeError|Cannot assign to read only property|read only/i,
  );
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

test("parses the reviewed pairing creation identity and rejects unknown fields", () => {
  assert.deepEqual(parseClientV1PairingCreateRequest({
    appName: " OpenCoven Chat ",
    installationId: "chat-install-1",
    scopes: ["chat:read", "github:write"],
  }), {
    appName: "OpenCoven Chat",
    installationId: "chat-install-1",
    scopes: ["chat:read", "github:write"],
  });
  assert.throws(
    () => parseClientV1PairingCreateRequest({
      appName: "OpenCoven Chat",
      installationId: "../chat-install",
      scopes: ["chat:read"],
    }),
    /installationId/i,
  );
  assert.throws(
    () => parseClientV1PairingCreateRequest({
      appName: "OpenCoven Chat",
      installationId: "chat-install-1",
      scopes: ["chat:read"],
      bearer: "not-reviewed",
    }),
    /unsupported field/i,
  );
});

test("exports additive Phase 1 health, pairing, credential, and discovery examples", () => {
  const fixture = createClientV1ContractFixture();
  assert.deepEqual(fixture.contract.publicRoutes, CLIENT_V1_PUBLIC_ROUTES);
  assert.equal(fixture.contract.pairingSecretHeader, CLIENT_V1_PAIRING_SECRET_HEADER);
  assert.deepEqual(fixture.contract.discovery, {
    fileName: "client-v1-discovery.json",
    mode: "0600",
    version: 1,
  });
  // The health envelope example must be the compatibility record the route
  // serves, so the fixture and /api/client/v1/health cannot drift apart.
  assert.deepEqual(fixture.examples.healthEnvelope.data, fixture.examples.health);
  assert.deepEqual(Object.keys(fixture.examples.healthEnvelope.data).sort(), [
    "instanceId",
    "pairingRequired",
    "releaseVersion",
  ]);
  assert.deepEqual(Object.keys(fixture.examples.pairingCreatedEnvelope.data), [
    "requestId",
    "secret",
    "expiresAt",
  ]);
  assert.deepEqual(fixture.examples.pairingStatusEnvelope.data, {
    id: "018f4f1a-77c2-7a31-8a15-55a25aaba001",
    status: "approved",
    expiresAt: 1_755_731_112_617,
  });
  assert.equal(
    "bearerHash" in fixture.examples.pairingExchangeEnvelope.data.credential,
    false,
  );
  assert.equal(
    "secretHash" in fixture.examples.pairingExchangeEnvelope.data,
    false,
  );
  assert.equal(fixture.examples.discoveryRecord.version, 1);
});

test("rate-limit responses carry canonical envelopes and Retry-After metadata", async () => {
  const response = clientV1RateLimitResponse({
    allowed: false,
    limit: 10,
    remaining: 0,
    resetAt: 61_000,
    retryAfterSeconds: 60,
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual((await response.json() as { error: unknown }).error, {
    code: "rate_limited",
    message: "Rate limit exceeded.",
    details: { limit: "10", resetAt: "61000" },
    retryable: true,
  });
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

test("preserves own __proto__ payload fields without mutating builder clones", async () => {
  const payload = parseJson<ClientV1Record>(
    '{"status":"ok","__proto__":{"preserved":"payload"},"nested":{"label":"accepted","__proto__":{"preserved":"nested"}}}',
  );

  assert.equal(Object.hasOwn(payload, "__proto__"), true);
  assert.equal(Object.hasOwn(payload.nested as ClientV1Record, "__proto__"), true);

  const success = clientV1Success(payload);

  assert.notStrictEqual(success.data, payload);
  assert.deepEqual(success.data, payload);
  assert.equal(Object.hasOwn(success.data, "__proto__"), true);
  assert.equal(Object.hasOwn(success.data.nested as ClientV1Record, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(success.data), Object.prototype);
  assert.equal(Object.getPrototypeOf(success.data.nested as ClientV1Record), Object.prototype);

  const roundTrip = (await clientV1SuccessResponse(payload).json()) as { data: ClientV1Record };
  assert.deepEqual(roundTrip, success);
  assert.equal(Object.hasOwn(roundTrip.data, "__proto__"), true);
  assert.equal(Object.hasOwn(roundTrip.data.nested as ClientV1Record, "__proto__"), true);
});

test("preserves own __proto__ cursor metadata without mutating builder clones", async () => {
  const cursor = parseJson<ClientV1Cursor>(
    '{"current":"cursor-1","hasMore":true,"__proto__":{"preserved":"cursor"},"nested":{"label":"accepted","__proto__":{"preserved":"cursor-nested"}}}',
  );

  assert.equal(Object.hasOwn(cursor, "__proto__"), true);
  assert.equal(Object.hasOwn(cursor.nested as ClientV1Record, "__proto__"), true);

  const success = clientV1Success({ status: "ok" }, { cursor });

  assert.notStrictEqual(success.cursor, cursor);
  assert.deepEqual(success.cursor, cursor);
  assert.equal(Object.hasOwn(success.cursor!, "__proto__"), true);
  assert.equal(Object.hasOwn(success.cursor!.nested as ClientV1Record, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(success.cursor!), Object.prototype);
  assert.equal(Object.getPrototypeOf(success.cursor!.nested as ClientV1Record), Object.prototype);

  const roundTrip = (await clientV1SuccessResponse({ status: "ok" }, { cursor }).json()) as {
    cursor: ClientV1Cursor;
  };
  assert.deepEqual(roundTrip.cursor, cursor);
  assert.equal(Object.hasOwn(roundTrip.cursor, "__proto__"), true);
  assert.equal(Object.hasOwn(roundTrip.cursor.nested as ClientV1Record, "__proto__"), true);
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
        capabilities: ["conversations", "cursors"],
        operations: ["conversations.list", "conversations.read"],
        requestId: "request-1",
        identity: { kind: "conversation", id: "conversation-1" },
        revision: { token: "revision-1", updatedAt: "2026-08-15T00:00:00.000Z" },
        cursor: { current: "cursor-1", next: "cursor-2", hasMore: true },
      },
    ),
    {
      apiVersion: "1.0",
      minimumClientVersion: "0.1.0",
      capabilities: ["conversations", "cursors"],
      operations: ["conversations.list", "conversations.read"],
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
    operations: [...CLIENT_V1_OPERATIONS],
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
    { capabilities: ["pairing"], operations: ["pairing.create"], status: 202 },
  );
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: ["pairing"],
    operations: ["pairing.create"],
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
    operations: [...CLIENT_V1_OPERATIONS],
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

test("rejects contradictory client v1 error status overrides", () => {
  assert.equal(
    clientV1ErrorResponse("rate_limited", "Please retry later.", { status: 429 }).status,
    429,
  );
  assert.equal(
    clientV1ErrorResponse("service_unavailable", "Please retry later.", { status: 503 }).status,
    503,
  );
  assert.throws(
    () => clientV1ErrorResponse("rate_limited", "Please retry later.", { status: 503 }),
    /canonical HTTP status/i,
  );
  assert.throws(
    () => clientV1ErrorResponse("not_found", "Missing conversation.", { status: 409 }),
    /canonical HTTP status/i,
  );
});

test("represents in-progress operations as retryable conflicts", () => {
  assert.deepEqual(clientV1OperationInProgressError("send-message"), {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: [...CLIENT_V1_CAPABILITIES],
    operations: [...CLIENT_V1_OPERATIONS],
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

test("builds a deterministic additive Phase 1 contract fixture", () => {
  const fixture = createClientV1ContractFixture();

  assert.deepEqual(fixture.contract, {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: [...CLIENT_V1_CAPABILITIES],
    // The MANIFEST publishes whole operation records, not bare ids — that is
    // what lets a client resolve an advertised id to a request without probing
    // arbitrary paths. The envelope carries ids alone because it rides every
    // response; the two are checked against each other below.
    operations: clientV1OperationRecords(),
    discovery: {
      fileName: "client-v1-discovery.json",
      mode: "0600",
      version: 1,
    },
    pairingRequired: true,
    pairingScopes: [...CLIENT_V1_SCOPES],
    pairingSecretHeader: "x-coven-pairing-secret",
    publicRoutes: [...CLIENT_V1_PUBLIC_ROUTES],
    identityKinds: [...CLIENT_V1_IDENTITY_KINDS],
    errorCodes: [...CLIENT_V1_ERROR_CODES],
    limits: CLIENT_V1_LIMITS,
  });
  assert.deepEqual(fixture.examples.status, { status: "ok" });
  assert.deepEqual(fixture.examples.health, {
    instanceId: "00000000-0000-4000-8000-000000000000",
    pairingRequired: true,
    releaseVersion: "0.0.0",
  });
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

test("copies protocol defaults into fixtures and envelope metadata", () => {
  const fixture = createClientV1ContractFixture();
  assert.notStrictEqual(fixture.contract.capabilities, CLIENT_V1_CAPABILITIES);
  assert.notStrictEqual(fixture.contract.pairingScopes, CLIENT_V1_SCOPES);
  assert.notStrictEqual(fixture.contract.errorCodes, CLIENT_V1_ERROR_CODES);
  assert.notStrictEqual(fixture.contract.identityKinds, CLIENT_V1_IDENTITY_KINDS);
  assert.notStrictEqual(fixture.contract.limits, CLIENT_V1_LIMITS);
  assert.notStrictEqual(fixture.contract.publicRoutes, CLIENT_V1_PUBLIC_ROUTES);
  assert.notStrictEqual(fixture.contract.discovery, CLIENT_V1_DISCOVERY_CONTRACT);

  fixture.contract.capabilities.pop();
  fixture.contract.pairingScopes.pop();
  fixture.contract.errorCodes.pop();
  fixture.contract.identityKinds.pop();
  fixture.contract.publicRoutes.pop();
  fixture.contract.operations.pop();
  fixture.contract.operations[0].families.pop();
  (fixture.contract.discovery as { mode: string }).mode = "0644";
  (fixture.contract.limits as { maxPageSize: number }).maxPageSize = 1;

  assert.deepEqual(clientV1Success({ status: "ok" }).capabilities, [...CLIENT_V1_CAPABILITIES]);
  assert.deepEqual(clientV1Success({ status: "ok" }).operations, [...CLIENT_V1_OPERATIONS]);
  assert.deepEqual(createClientV1ContractFixture().contract.operations, clientV1OperationRecords());
  assert.deepEqual(createClientV1ContractFixture().contract.limits, CLIENT_V1_LIMITS);
  assert.deepEqual(
    createClientV1ContractFixture().contract.publicRoutes,
    CLIENT_V1_PUBLIC_ROUTES,
  );
  assert.deepEqual(
    createClientV1ContractFixture().contract.discovery,
    CLIENT_V1_DISCOVERY_CONTRACT,
  );

  const identity: ClientV1Identity & { extension: { labels: string[] } } = {
    kind: "conversation",
    id: "conversation-1",
    extension: {
      labels: ["stable"],
    },
  };
  const revision: ClientV1Revision & { extension: { labels: string[] } } = {
    token: "revision-1",
    updatedAt: "2026-08-15T00:00:00.000Z",
    extension: {
      labels: ["stable"],
    },
  };
  const cursor: ClientV1Cursor & { extension: { labels: string[] } } = {
    current: "cursor-1",
    hasMore: true,
    extension: {
      labels: ["stable"],
    },
  };

  const success = clientV1Success(
    { status: "ok" },
    {
      identity,
      revision,
      cursor,
    },
  );

  const successIdentity = success.identity! as ClientV1Identity & { extension: { labels: string[] } };
  const successRevision = success.revision! as ClientV1Revision & { extension: { labels: string[] } };
  const successCursor = success.cursor! as ClientV1Cursor & { extension: { labels: string[] } };

  assert.notStrictEqual(success.identity, identity);
  assert.notStrictEqual(success.revision, revision);
  assert.notStrictEqual(success.cursor, cursor);
  assert.notStrictEqual(successIdentity.extension, identity.extension);
  assert.notStrictEqual(successRevision.extension, revision.extension);
  assert.notStrictEqual(successCursor.extension, cursor.extension);

  identity.extension.labels[0] = "mutated";
  revision.extension.labels[0] = "mutated";
  cursor.extension.labels[0] = "mutated";

  assert.deepEqual(successIdentity.extension, { labels: ["stable"] });
  assert.deepEqual(successRevision.extension, { labels: ["stable"] });
  assert.deepEqual(successCursor.extension, { labels: ["stable"] });
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

  // `operations` is required, not optional. It is what an SDK's `supports()`
  // reads, and a field a client has to test for the presence of is a field it
  // cannot rely on — which is how the surface ended up with a declaration
  // nobody could trust in the first place.
  const withoutOperations = { ...fixture.examples.successEnvelope } as Record<string, unknown>;
  delete withoutOperations.operations;
  assert.throws(() => parseClientV1SuccessEnvelope(withoutOperations), /operations/i);
  const errorWithoutOperations = { ...fixture.examples.errorEnvelope } as Record<string, unknown>;
  delete errorWithoutOperations.operations;
  assert.throws(() => parseClientV1ErrorEnvelope(errorWithoutOperations), /operations/i);
  assert.throws(
    () => parseClientV1SuccessEnvelope({
      ...fixture.examples.successEnvelope,
      operations: ["streaming.subscribe"],
    }),
    /operations entry is not supported/,
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
    operations: [...CLIENT_V1_OPERATIONS],
    data: futureRouteLike,
  });

  const emptyEnvelope = clientV1Success({});
  assert.deepEqual(emptyEnvelope.data, {});
  const emptyResponse = clientV1SuccessResponse({});
  assert.deepEqual(await emptyResponse.json(), {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: [...CLIENT_V1_CAPABILITIES],
    operations: [...CLIENT_V1_OPERATIONS],
    data: {},
  });
});
