import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_MIN_CLIENT_VERSION,
  CLIENT_V1_SCOPES,
  parseIdempotencyKey,
  parsePairingRequest,
} from "./contract.ts";
import { clientV1Error, clientV1Ok } from "./responses.ts";

test("locks the public v1 version and scope constants", () => {
  assert.equal(CLIENT_V1_API_VERSION, "1.0");
  assert.equal(CLIENT_V1_MIN_CLIENT_VERSION, "0.1.0");
  assert.deepEqual(CLIENT_V1_SCOPES, [
    "chat:read",
    "chat:write",
    "conversations:write",
    "attachments:write",
    "tasks:write",
    "github:write",
  ]);
});

test("parses a valid least-privilege pairing request exactly", () => {
  const parsed = parsePairingRequest({
    appName: "  OpenCoven Mobile  ",
    installationId: "  4E8B1B3E-9C1A-4F0A-8B1A-0C1D2E3F4A5B  ",
    scopes: ["chat:read"],
  });
  assert.deepEqual(parsed, {
    appName: "OpenCoven Mobile",
    installationId: "4E8B1B3E-9C1A-4F0A-8B1A-0C1D2E3F4A5B",
    scopes: ["chat:read"],
  });
});

test("rejects a pairing request that asks for an unknown scope", () => {
  assert.throws(() =>
    parsePairingRequest({
      appName: "OpenCoven Mobile",
      installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
      scopes: ["chat:read", "admin"],
    }),
  );
});

test("rejects a pairing request carrying any field outside appName/installationId/scopes", () => {
  const base = {
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read"],
  };
  assert.throws(() => parsePairingRequest({ ...base, extra: "nope" }));
  assert.throws(() => parsePairingRequest({ ...base, admin: true }));
  // Even a field that merely shadows an internal/reserved-looking name must
  // be rejected — the allowlist is exact, not a denylist of "dangerous" keys.
  assert.throws(() => parsePairingRequest({ ...base, status: "approved" }));
  // A valid body with no extra keys must still be accepted.
  assert.deepEqual(parsePairingRequest(base), base);
});

test("rejects pairing requests with malformed shapes", () => {
  const base = {
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read"],
  };

  assert.throws(() => parsePairingRequest(null));
  assert.throws(() => parsePairingRequest([]));
  assert.throws(() => parsePairingRequest("nope"));
  assert.throws(() => parsePairingRequest({ ...base, appName: "A" }));
  assert.throws(() => parsePairingRequest({ ...base, appName: "x".repeat(81) }));
  assert.throws(() => parsePairingRequest({ ...base, installationId: "not-a-uuid" }));
  assert.throws(() => parsePairingRequest({ ...base, scopes: [] }));
  assert.throws(() => parsePairingRequest({ ...base, scopes: "chat:read" }));
});

test("deduplicates pairing scopes without reordering", () => {
  const parsed = parsePairingRequest({
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:write", "chat:read", "chat:write", "chat:read"],
  });
  assert.deepEqual(parsed.scopes, ["chat:write", "chat:read"]);
});

test("trims whitespace around scope strings before validating", () => {
  const parsed = parsePairingRequest({
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["  chat:read  ", "\tchat:write\n"],
  });
  assert.deepEqual(parsed.scopes, ["chat:read", "chat:write"]);
});

test("rejects a scope that is only whitespace", () => {
  assert.throws(() =>
    parsePairingRequest({
      appName: "OpenCoven Mobile",
      installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
      scopes: ["   "],
    }),
  );
});

test("rejects a non-string scope element", () => {
  assert.throws(() =>
    parsePairingRequest({
      appName: "OpenCoven Mobile",
      installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
      scopes: [123],
    }),
  );
});

test("deduplicates scopes after trimming, preserving first-occurrence order", () => {
  const parsed = parsePairingRequest({
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:write", "  chat:read  ", "chat:write  ", "\tchat:read"],
  });
  assert.deepEqual(parsed.scopes, ["chat:write", "chat:read"]);
});

test("parses a well-formed UUID idempotency key", () => {
  const key = "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b";
  assert.equal(parseIdempotencyKey(`  ${key}  `), key);
});

test("rejects an invalid idempotency key", () => {
  assert.throws(() => parseIdempotencyKey("not-a-uuid"));
  assert.throws(() => parseIdempotencyKey(""));
  assert.throws(() => parseIdempotencyKey(null));
});

test("produces the exact stable 403 error envelope", async () => {
  const response = clientV1Error(403, "scope_denied", "Missing required scope.", false);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    error: {
      code: "scope_denied",
      message: "Missing required scope.",
      retryable: false,
    },
  });
});

test("includes optional details and diagnosticId when provided", async () => {
  const response = clientV1Error(409, "conflict", "Already paired.", false, {
    details: { existingPairingId: "abc" },
    diagnosticId: "diag-123",
  });
  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    error: {
      code: "conflict",
      message: "Already paired.",
      retryable: false,
      details: { existingPairingId: "abc" },
      diagnosticId: "diag-123",
    },
  });
});

test("clientV1Ok returns the given status and preserves the body", async () => {
  const response = clientV1Ok({ ok: true, pairingId: "p1" }, { status: 201 });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, pairingId: "p1" });
});

test("clientV1Ok defaults to status 200", async () => {
  const response = clientV1Ok({ ok: true });
  assert.equal(response.status, 200);
});

test("a 500 helper never leaks a raw sensitive message to the client", async () => {
  const response = clientV1Error(
    500,
    "internal_error",
    "ENOENT: no such file /Users/val/.secrets/token at db.connect",
    true,
  );
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "internal_error");
  assert.equal(body.error.retryable, true);
  assert.notEqual(body.error.message, "ENOENT: no such file /Users/val/.secrets/token at db.connect");
  assert.doesNotMatch(body.error.message, /ENOENT|\/Users\/val|db\.connect/);
});

test("a 503 helper also uses the safe generic message", async () => {
  const response = clientV1Error(503, "service_unavailable", "connection refused to internal-db-host:5432", true);
  const body = await response.json();
  assert.doesNotMatch(body.error.message, /internal-db-host|5432/);
});
