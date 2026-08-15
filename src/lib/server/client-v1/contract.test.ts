import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_ERROR_CODES,
  CLIENT_V1_MIN_CLIENT_VERSION,
  CLIENT_V1_SCOPES,
  ClientV1RequestError,
  isClientV1Scope,
  parseIdempotencyKey,
  parsePairingRequest,
} from "./contract.ts";
import {
  CLIENT_V1_SUCCESS_STATUSES,
  clientV1Error,
  clientV1ErrorStatus,
  clientV1Ok,
  isClientV1SuccessStatus,
} from "./responses.ts";

const VALID_INSTALLATION_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function assertInvalidRequest(fn: () => unknown, expectedMessage?: string): void {
  try {
    fn();
    assert.fail("expected ClientV1RequestError");
  } catch (err) {
    assert.ok(err instanceof ClientV1RequestError);
    assert.equal(err.code, "invalid_request");
    if (expectedMessage !== undefined) {
      assert.equal(err.message, expectedMessage);
    }
  }
}

test("the v1 contract version constants are locked", () => {
  assert.equal(CLIENT_V1_API_VERSION, "1.0");
  assert.equal(CLIENT_V1_MIN_CLIENT_VERSION, "0.1.0");
});

test("the known scope tuple is exactly the approved least-privilege set", () => {
  assert.deepEqual(CLIENT_V1_SCOPES, [
    "chat:read",
    "chat:write",
    "conversations:write",
    "attachments:write",
    "tasks:write",
    "github:write",
  ]);
});

test("isClientV1Scope recognizes only the known scopes", () => {
  for (const scope of CLIENT_V1_SCOPES) {
    assert.equal(isClientV1Scope(scope), true, scope);
  }
  for (const notAScope of ["admin", "*", "chat:delete", "conversations:read", "", 1, null, undefined]) {
    assert.equal(isClientV1Scope(notAScope), false, JSON.stringify(notAScope));
  }
});

test("parsePairingRequest accepts a request naming only known least-privilege scopes", () => {
  assert.deepEqual(
    parsePairingRequest({
      appName: "Cave iOS",
      installationId: VALID_INSTALLATION_ID,
      scopes: ["chat:read", "chat:write"],
    }),
    {
      appName: "Cave iOS",
      installationId: VALID_INSTALLATION_ID,
      scopes: ["chat:read", "chat:write"],
    },
  );
});

test("parsePairingRequest de-duplicates repeated scopes while preserving first-seen order", () => {
  const result = parsePairingRequest({
    appName: "Cave iOS",
    installationId: VALID_INSTALLATION_ID,
    scopes: ["chat:write", "chat:read", "chat:write", "chat:read"],
  });
  assert.deepEqual(result.scopes, ["chat:write", "chat:read"]);
});

test("parsePairingRequest rejects unknown and admin-shaped scopes", () => {
  for (const scopes of [
    ["admin"],
    ["*"],
    ["admin:all"],
    ["chat:read", "root"],
    ["chat:read", "*"],
    ["chat:read", "chat:delete"],
  ]) {
    assertInvalidRequest(
      () =>
        parsePairingRequest({
          appName: "Cave iOS",
          installationId: VALID_INSTALLATION_ID,
          scopes,
        }),
      `Unknown scope: ${JSON.stringify(scopes.at(-1))}`,
    );
  }
});

test("parsePairingRequest requires at least one scope", () => {
  assertInvalidRequest(
    () =>
      parsePairingRequest({
        appName: "Cave iOS",
        installationId: VALID_INSTALLATION_ID,
        scopes: [],
      }),
    "scopes must be a non-empty array",
  );
});

test("parsePairingRequest rejects scopes that are not an array", () => {
  for (const scopes of ["chat:read", { "chat:read": true }, null, undefined, 1]) {
    assertInvalidRequest(
      () =>
        parsePairingRequest({
          appName: "Cave iOS",
          installationId: VALID_INSTALLATION_ID,
          scopes,
        }),
      "scopes must be a non-empty array",
    );
  }
});

test("parsePairingRequest rejects a body that is not a plain non-array object", () => {
  class Foo {
    appName = "Cave iOS";
    installationId = VALID_INSTALLATION_ID;
    scopes = ["chat:read"];
  }

  for (const body of [
    null,
    undefined,
    "string",
    42,
    true,
    [],
    ["chat:read"],
    new Date(),
    new Map(),
    new Foo(),
    Object.assign(Object.create(Array.prototype), {
      appName: "Cave iOS",
      installationId: VALID_INSTALLATION_ID,
      scopes: ["chat:read"],
    }),
  ]) {
    assertInvalidRequest(() => parsePairingRequest(body), "Request body must be a JSON object");
  }
});

test("parsePairingRequest accepts true plain objects, including null-prototype objects", () => {
  const nullProto = Object.assign(Object.create(null), {
    appName: "Cave iOS",
    installationId: VALID_INSTALLATION_ID,
    scopes: ["chat:read"],
  });
  assert.deepEqual(parsePairingRequest(nullProto), {
    appName: "Cave iOS",
    installationId: VALID_INSTALLATION_ID,
    scopes: ["chat:read"],
  });
});

test("parsePairingRequest trims and bounds appName to 2..80 characters", () => {
  const base = { installationId: VALID_INSTALLATION_ID, scopes: ["chat:read"] };

  assert.equal(parsePairingRequest({ ...base, appName: "  Cave  " }).appName, "Cave");
  assert.equal(parsePairingRequest({ ...base, appName: "AB" }).appName, "AB");
  assert.equal(parsePairingRequest({ ...base, appName: "A".repeat(80) }).appName, "A".repeat(80));

  for (const appName of ["A", "  A  ", "", "   ", "A".repeat(81), 42]) {
    assertInvalidRequest(
      () => parsePairingRequest({ ...base, appName }),
      typeof appName === "string"
        ? `appName must be between 2 and 80 characters`
        : "appName must be a string",
    );
  }
});

test("parsePairingRequest requires installationId to be a UUID and normalizes its case", () => {
  const base = { appName: "Cave iOS", scopes: ["chat:read"] };

  for (const installationId of [
    "not-a-uuid",
    "",
    12345,
    null,
    undefined,
    `${VALID_INSTALLATION_ID}-extra`,
    "3fa85f64-5717-0562-b3fc-2c963f66afa6",
    "3fa85f64-5717-4562-73fc-2c963f66afa6",
  ]) {
    assertInvalidRequest(
      () => parsePairingRequest({ ...base, installationId }),
      "installationId must be a UUID",
    );
  }

  assert.equal(
    parsePairingRequest({ ...base, installationId: VALID_INSTALLATION_ID.toUpperCase() }).installationId,
    VALID_INSTALLATION_ID,
  );
});

test("parsePairingRequest trims surrounding whitespace from installationId before validating and returning it", () => {
  const base = { appName: "Cave iOS", scopes: ["chat:read"] };

  assert.equal(
    parsePairingRequest({ ...base, installationId: ` ${VALID_INSTALLATION_ID}` }).installationId,
    VALID_INSTALLATION_ID,
  );
  assert.equal(
    parsePairingRequest({ ...base, installationId: `${VALID_INSTALLATION_ID} ` }).installationId,
    VALID_INSTALLATION_ID,
  );
  assert.equal(
    parsePairingRequest({ ...base, installationId: `\t${VALID_INSTALLATION_ID}\n` }).installationId,
    VALID_INSTALLATION_ID,
  );

  // Whitespace padding must not smuggle in an otherwise-invalid value.
  assertInvalidRequest(
    () => parsePairingRequest({ ...base, installationId: "   not-a-uuid   " }),
    "installationId must be a UUID",
  );
});

test("parseIdempotencyKey requires a UUID and returns it directly, trimming surrounding whitespace", () => {
  assert.equal(parseIdempotencyKey(VALID_INSTALLATION_ID), VALID_INSTALLATION_ID);
  assert.equal(parseIdempotencyKey(VALID_INSTALLATION_ID.toUpperCase()), VALID_INSTALLATION_ID);
  assert.equal(parseIdempotencyKey(` ${VALID_INSTALLATION_ID}`), VALID_INSTALLATION_ID);
  assert.equal(parseIdempotencyKey(`${VALID_INSTALLATION_ID} `), VALID_INSTALLATION_ID);
  assert.equal(parseIdempotencyKey(`\t${VALID_INSTALLATION_ID}\n`), VALID_INSTALLATION_ID);
});

test("parseIdempotencyKey rejects malformed UUIDs, including invalid version and variant nibbles", () => {
  for (const raw of [
    undefined,
    null,
    42,
    "",
    "   ",
    "not-a-uuid",
    "3fa85f64-5717-4562-b3fc-2c963f66afa",
    "3fa85f64-5717-4562-b3fc-2c963f66afa6-",
    "3fa85f64-5717-0562-b3fc-2c963f66afa6",
    "3fa85f64-5717-4562-73fc-2c963f66afa6",
    ["not", "a", "string"],
    { key: VALID_INSTALLATION_ID },
  ]) {
    assertInvalidRequest(
      () => parseIdempotencyKey(raw as string | null),
      "Idempotency-Key must be a UUID",
    );
  }
});

test("parsePairingRequest and parseIdempotencyKey return the parsed value directly and throw on failure, never a result wrapper", () => {
  const value = parsePairingRequest({
    appName: "Cave iOS",
    installationId: VALID_INSTALLATION_ID,
    scopes: ["chat:read"],
  });
  // The success path is the bare parsed value: no `{ ok, value }` wrapper.
  assert.ok(!("ok" in value));
  assert.ok(!("value" in value));
  assert.deepEqual(value, {
    appName: "Cave iOS",
    installationId: VALID_INSTALLATION_ID,
    scopes: ["chat:read"],
  });

  const key = parseIdempotencyKey(VALID_INSTALLATION_ID);
  assert.equal(typeof key, "string");

  // The failure path is a thrown ClientV1RequestError, not a returned
  // `{ ok: false, ... }` value.
  try {
    parsePairingRequest({ appName: "Cave iOS", installationId: "not-a-uuid", scopes: ["chat:read"] });
    assert.fail("expected parsePairingRequest to throw");
  } catch (err) {
    assert.ok(err instanceof ClientV1RequestError);
    assert.equal(err.code, "invalid_request");
  }

  try {
    parseIdempotencyKey("not-a-uuid");
    assert.fail("expected parseIdempotencyKey to throw");
  } catch (err) {
    assert.ok(err instanceof ClientV1RequestError);
    assert.equal(err.code, "invalid_request");
  }
});

test("clientV1Error returns a stable envelope with the mapped status", async () => {
  const status = clientV1ErrorStatus("invalid_request");
  const res = clientV1Error(status, "invalid_request", "appName is required", false);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.deepEqual(body, {
    ok: false,
    error: { code: "invalid_request", message: "appName is required", retryable: false },
  });
});

test("clientV1Error never relays raw messages for 5xx responses", async () => {
  const sensitive = "TypeError: cannot read /Users/buns/.coven/secrets/token.json";
  for (const code of ["internal_error", "service_unavailable"] as const) {
    const status = clientV1ErrorStatus(code);
    const res = clientV1Error(status, code, sensitive, true);
    assert.ok(res.status >= 500, `${code} must map to a 5xx status`);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, code);
    assert.notEqual(body.error.message, sensitive);
    assert.doesNotMatch(body.error.message, /secrets|token\.json/);
  }
});

test("clientV1Error resolves mismatched status/code pairs to the canonical status", async () => {
  const res = clientV1Error(500, "invalid_request", "appName is required", false);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.deepEqual(body, {
    ok: false,
    error: { code: "invalid_request", message: "An internal error occurred.", retryable: false },
  });
});

test("clientV1Error redacts a caller-supplied 500 even when the canonical code is a 4xx", async () => {
  const sensitive = "SECRET: /Users/buns/.coven/secrets/token.json";
  const res = clientV1Error(500, "invalid_request", sensitive, false);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "invalid_request");
  assert.equal(body.error.message, "An internal error occurred.");
  assert.notEqual(body.error.message, sensitive);
  assert.doesNotMatch(JSON.stringify(body), /SECRET:|token\.json/);
});

test("clientV1Error still redacts internal_error messages when the caller status mismatches", async () => {
  const res = clientV1Error(400, "internal_error", "SECRET", false);
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.deepEqual(body, {
    ok: false,
    error: { code: "internal_error", message: "An internal error occurred.", retryable: false },
  });
});

test("clientV1Error relays the given message for sub-500 statuses", async () => {
  for (const code of CLIENT_V1_ERROR_CODES) {
    const status = clientV1ErrorStatus(code);
    if (status >= 500) continue;
    const res = clientV1Error(status, code, `${code} message`, false);
    const body = await res.json();
    assert.equal(body.error.message, `${code} message`, code);
  }
});

test("clientV1Error passes retryable through and omits optional fields when not given", async () => {
  const status = clientV1ErrorStatus("rate_limited");
  const res = clientV1Error(status, "rate_limited", "slow down", true);
  const body = await res.json();
  assert.equal(body.error.retryable, true);
  assert.ok(!("details" in body.error));
  assert.ok(!("diagnosticId" in body.error));
});

test("clientV1Error includes details and diagnosticId only when supplied", async () => {
  const status = clientV1ErrorStatus("conflict");
  const res = clientV1Error(status, "conflict", "already paired", false, {
    details: { existingPairingId: "abc" },
    diagnosticId: "diag-123",
  });
  const body = await res.json();
  assert.deepEqual(body.error.details, { existingPairingId: "abc" });
  assert.equal(body.error.diagnosticId, "diag-123");
});

test("clientV1Error maps every documented error code to its expected HTTP status", () => {
  const expected: Record<(typeof CLIENT_V1_ERROR_CODES)[number], number> = {
    invalid_request: 400,
    unauthorized: 401,
    scope_denied: 403,
    not_found: 404,
    conflict: 409,
    rate_limited: 429,
    pairing_pending: 202,
    pairing_denied: 403,
    pairing_expired: 410,
    incompatible_version: 400,
    service_unavailable: 503,
    internal_error: 500,
  };
  for (const code of CLIENT_V1_ERROR_CODES) {
    assert.equal(clientV1ErrorStatus(code), expected[code], code);
  }
});

test("clientV1Ok returns a stable success envelope", async () => {
  const res = clientV1Ok({ pairingId: VALID_INSTALLATION_ID });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, pairingId: VALID_INSTALLATION_ID });
});

test("clientV1Ok accepts a custom status and never lets payload data override ok", async () => {
  const res = clientV1Ok({ ok: false, pairingId: VALID_INSTALLATION_ID }, { status: 201 });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, pairingId: VALID_INSTALLATION_ID });
});

test("clientV1Ok accepts every documented success status (200/201/202)", async () => {
  assert.deepEqual(CLIENT_V1_SUCCESS_STATUSES, [200, 201, 202]);
  for (const status of CLIENT_V1_SUCCESS_STATUSES) {
    const res = clientV1Ok({ pairingId: VALID_INSTALLATION_ID }, { status });
    assert.equal(res.status, status);
    const body = await res.json();
    assert.deepEqual(body, { ok: true, pairingId: VALID_INSTALLATION_ID });
  }
});

test("clientV1Ok rejects bodyless and error statuses before building a response", () => {
  // These are not `ClientV1SuccessStatus` at the type level; casting to
  // `never` simulates an unchecked JavaScript/`any` caller bypassing the
  // compiler to prove the runtime guard still rejects them.
  for (const status of [204, 205, 304, 400, 500] as const) {
    assert.throws(() => clientV1Ok({}, { status: status as never }), /invalid success status/);
  }
});

test("isClientV1SuccessStatus accepts only 200/201/202", () => {
  for (const status of CLIENT_V1_SUCCESS_STATUSES) {
    assert.equal(isClientV1SuccessStatus(status), true, String(status));
  }
  for (const status of [0, 199, 204, 205, 300, 304, 400, 401, 404, 500, "200", null, undefined]) {
    assert.equal(isClientV1SuccessStatus(status), false, String(status));
  }
});

console.log("contract.test.ts: ok");
