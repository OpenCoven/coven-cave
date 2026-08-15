import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, beforeEach, test } from "node:test";

import { CLIENT_V1_LOCAL_HEADER } from "../../../proxy-helpers.ts";

// ─── source-contract: the marker is verified via the shared constant-time
// helper, never a direct string comparison ─────────────────────────────────
//
// Mirrors local-origin.test.ts's own source-contract assertion for the
// sidecar-token check: a plain `headerValue === secret` comparison leaks
// timing information about how much of a guessed secret matched, so the
// marker check must go through `isTrustedLocalPeer` (proxy-helpers.ts),
// which is itself proven constant-time elsewhere. This only proves auth.ts
// imports and calls that shared helper — not the helper's own internals.
const authSource = readFileSync(fileURLToPath(new URL("./auth.ts", import.meta.url)), "utf8");
assert.match(
  authSource,
  /import\s*\{[^}]*\bisTrustedLocalPeer\b[^}]*\}\s*from\s*["']@\/proxy-helpers["']/,
  "auth.ts must import the shared constant-time isTrustedLocalPeer helper",
);
assert.match(
  authSource,
  /isTrustedLocalPeer\(req\.headers\.get\(CLIENT_V1_LOCAL_HEADER\),\s*deps\.localPeerSecret\(\)\)/,
  "the marker must be verified by calling isTrustedLocalPeer, not a direct string comparison",
);
// A direct `===` comparison against the marker header would defeat the
// point of the constant-time helper — this source must never contain one.
assert.doesNotMatch(
  authSource,
  /headerValue\s*===\s*secret|marker\s*===|===\s*deps\.localPeerSecret/,
  "the marker must never be compared with a direct (non-constant-time) equality check",
);

// Lives inside this worktree's own `process.cwd()` — never `os.tmpdir()` and
// never anywhere outside this repo's granted filesystem boundary. Only this
// exact directory is removed on cleanup.
const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-auth-"));
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "client-v1-credentials.json");

const LOCAL_PEER_SECRET = "test-per-boot-secret-do-not-reuse";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;

const {
  clientCredentialStorePath,
  clientCredentialSettlementJournalPath,
  issueCredential,
  issueCredentialForPairingSettlement,
  revokeCredential,
  setPostReadDelayForTest,
  settlePairingCredentialSettlement,
} = await import("./credential-store.ts");
const { resetRateLimitsForTest } = await import("./rate-limit.ts");
const { createClientAuthorizer, requireClientPrincipal } = await import("./auth.ts");

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  await Promise.all([
    rm(clientCredentialStorePath(), { force: true }),
    rm(clientCredentialSettlementJournalPath(), { force: true }),
  ]);
  setPostReadDelayForTest(null);
  resetRateLimitsForTest();
});

function approvedPairing(overrides: Partial<Parameters<typeof issueCredential>[0]> = {}) {
  return {
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read" as const],
    status: "approved" as const,
    ...overrides,
  };
}

function requestWith(options: {
  marker?: string | null;
  authorization?: string | null;
} = {}) {
  const headers = new Headers();
  if (options.marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, options.marker ?? LOCAL_PEER_SECRET);
  if (options.authorization !== null && options.authorization !== undefined) {
    headers.set("authorization", options.authorization);
  }
  return new Request("http://127.0.0.1/api/client/v1/example", { headers });
}

async function readErrorBody(response: Response): Promise<{ ok: false; error: { code: string; retryable: boolean } }> {
  return response.json();
}

// ─── absent/bad marker -> 403 before token handling ───────────────────────

test("an absent internal marker returns 403 unauthorized, even with no Authorization header at all", async () => {
  const req = requestWith({ marker: null, authorization: null });
  const result = await requireClientPrincipal(req, "chat:read");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 403);
  const body = await readErrorBody(result.response);
  assert.equal(body.error.code, "unauthorized");
  assert.equal(body.error.retryable, false);
});

test("an absent internal marker returns 403 before any bearer token is even inspected", async () => {
  // A syntactically well-formed bearer is present, but the marker is still
  // missing — the 403 must win, proving marker verification runs first.
  const req = requestWith({ marker: null, authorization: "Bearer whatever-looks-fine" });
  const result = await requireClientPrincipal(req, "chat:read");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 403);
  const body = await readErrorBody(result.response);
  assert.equal(body.error.code, "unauthorized");
});

test("a wrong internal marker value returns 403 unauthorized", async () => {
  const req = requestWith({ marker: "guessed-value", authorization: "Bearer whatever-looks-fine" });
  const result = await requireClientPrincipal(req, "chat:read");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 403);
  const body = await readErrorBody(result.response);
  assert.equal(body.error.code, "unauthorized");
});

test("the 403 marker response never reveals the expected secret or any detail about why it failed", async () => {
  const req = requestWith({ marker: "guessed-value" });
  const result = await requireClientPrincipal(req, "chat:read");
  assert.equal(result.ok, false);
  if (result.ok) return;
  const raw = await result.response.clone().text();
  assert.equal(raw.includes(LOCAL_PEER_SECRET), false);
  assert.equal(raw.includes("guessed-value"), false);
  assert.equal(raw.includes("marker"), false);
});

// ─── missing/malformed bearer -> 401 (correct marker) ─────────────────────

test("a missing or malformed Authorization header returns 401 unauthorized", async () => {
  const malformed = [
    null,
    "Bearer",
    "Bearer   ",
    "Bearer a b",
    "Basic dGVzdA==",
    "bearer lowercase-scheme",
  ];
  for (const authorization of malformed) {
    const req = requestWith({ authorization });
    const result = await requireClientPrincipal(req, "chat:read");
    assert.equal(result.ok, false, `expected failure for Authorization: ${JSON.stringify(authorization)}`);
    if (result.ok) continue;
    assert.equal(result.response.status, 401, `expected 401 for Authorization: ${JSON.stringify(authorization)}`);
    const body = await readErrorBody(result.response);
    assert.equal(body.error.code, "unauthorized");
  }
});

// ─── valid token + exact scope -> safe principal ──────────────────────────

test("a valid token with the required scope returns a safe principal", async () => {
  const { token, credential } = await issueCredential(approvedPairing(), 1_000);
  const req = requestWith({ authorization: `Bearer ${token}` });
  const result = await requireClientPrincipal(req, "chat:read");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.principal, {
    credentialId: credential.id,
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read"],
  });

  assert.equal("tokenHash" in result.principal, false, "the principal must never carry the token hash");
  assert.equal(JSON.stringify(result.principal).includes(token), false, "the principal must never carry the raw bearer");
});

test("the first authenticated bearer use acknowledges delivery without permitting exchange replay", async () => {
  const context = {
    pairingId: "7e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    pairingSecret: "delivery-acknowledgement-secret",
    idempotencyKey: "8e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    requestHash: "a".repeat(64),
    claimId: "9e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
  };
  const issued = await issueCredentialForPairingSettlement(approvedPairing(), context, 1_000);
  assert.equal(
    await settlePairingCredentialSettlement(context, null, context.claimId, 1_001),
    true,
  );

  const authorizer = createClientAuthorizer({ now: () => 1_002 });
  const result = await authorizer(
    requestWith({ authorization: `Bearer ${issued.token}` }),
    "chat:read",
  );
  assert.equal(result.ok, true);

  const journal = JSON.parse(await readFile(clientCredentialSettlementJournalPath(), "utf8"));
  assert.equal(journal.replays.length, 1);
  assert.equal(journal.replays[0].sealedToken, null);
  assert.equal(journal.replays[0].deliveryAcknowledgedAt, 1_002);
});

test("a valid token with every required scope passes a multi-scope authorization", async () => {
  const { token, credential } = await issueCredential(
    approvedPairing({ scopes: ["chat:write", "tasks:write"] }),
    1_000,
  );
  const req = requestWith({ authorization: `Bearer ${token}` });
  const result = await requireClientPrincipal(req, ["chat:write", "tasks:write"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.principal.credentialId, credential.id);
  assert.deepEqual(result.principal.scopes, ["chat:write", "tasks:write"]);
});

// ─── under-scoped token -> 403 scope_denied ───────────────────────────────

test("a token lacking the required scope returns 403 scope_denied", async () => {
  const { token } = await issueCredential(approvedPairing({ scopes: ["chat:read"] }), 1_000);
  const req = requestWith({ authorization: `Bearer ${token}` });
  const result = await requireClientPrincipal(req, "chat:write");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 403);
  const body = await readErrorBody(result.response);
  assert.equal(body.error.code, "scope_denied");
});

test("a token missing any one required scope returns 403 scope_denied", async () => {
  const { token } = await issueCredential(
    approvedPairing({ scopes: ["chat:write"] }),
    1_000,
  );
  const req = requestWith({ authorization: `Bearer ${token}` });
  const result = await requireClientPrincipal(req, ["chat:write", "tasks:write"]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 403);
  const body = await readErrorBody(result.response);
  assert.equal(body.error.code, "scope_denied");
});

// ─── revoked/wrong token -> 401 ────────────────────────────────────────────

test("a revoked token returns 401 unauthorized", async () => {
  const { token, credential } = await issueCredential(approvedPairing(), 1_000);
  await revokeCredential(credential.id, 2_000);
  const req = requestWith({ authorization: `Bearer ${token}` });
  const result = await requireClientPrincipal(req, "chat:read");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 401);
  const body = await readErrorBody(result.response);
  assert.equal(body.error.code, "unauthorized");
});

test("a wrong/unknown token returns 401 unauthorized", async () => {
  await issueCredential(approvedPairing(), 1_000);
  const req = requestWith({ authorization: "Bearer not-a-real-token" });
  const result = await requireClientPrincipal(req, "chat:read");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 401);
  const body = await readErrorBody(result.response);
  assert.equal(body.error.code, "unauthorized");
});

// ─── invalid tokens never consume the authenticated bucket ───────────────
// (there is no separate shared pre-auth bucket to bound this traffic
// instead — see the injected-dependency tests below, which prove
// `consumeAuthenticatedRateLimit` is never even called until identity AND
// scope are both proven)

test("invalid tokens never consume a real credential's authenticated rate-limit bucket", async () => {
  const { token } = await issueCredential(approvedPairing(), 1_000);
  let now = 10_000;
  const authorizer = createClientAuthorizer({ now: () => now });

  // Hammer with an invalid token — every one of these must fail on identity
  // (401), never touch the real credential's own budget.
  for (let i = 0; i < 150; i++) {
    const req = requestWith({ authorization: "Bearer bogus-invalid-token" });
    const result = await authorizer(req, "chat:read");
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.response.status, 401, "invalid attempts must fail identity, never the credential limiter");
  }

  // The real credential's own bucket must be untouched by any of the above:
  // it is keyed by credential id, and invalid-token requests never resolve
  // to any credential id at all.
  const req = requestWith({ authorization: `Bearer ${token}` });
  const result = await authorizer(req, "chat:read");
  assert.equal(result.ok, true, "the real credential's bucket was never consumed by unrelated invalid attempts");
});

// ─── injected-dependency ordering proofs ──────────────────────────────────
// These build an authorizer whose `verifyCredential`, authenticated
// limiter, and `recordCredentialUse` are all spies, so each test can assert
// on exactly whether/when they were invoked — proving the specified
// ordering (marker -> bearer -> verify -> scope -> throttle -> bookkeeping)
// without relying on incidental behavior from the real credential store.

function spyDeps(overrides: {
  verifyCredential?: (token: string, now?: number) => Promise<import("./credential-store.ts").SafeClientCredential | null>;
  consumeAuthenticatedRateLimit?: (credentialId: string, now?: number) => import("./rate-limit.ts").RateLimitResult;
  recordCredentialUse?: (id: string, now?: number) => Promise<void>;
} = {}) {
  const verifyCredentialCalls: string[] = [];
  const consumeAuthenticatedRateLimitCalls: string[] = [];
  const recordCredentialUseCalls: string[] = [];

  const verifyCredential = async (token: string, now?: number) => {
    verifyCredentialCalls.push(token);
    return overrides.verifyCredential ? overrides.verifyCredential(token, now) : null;
  };
  const consumeAuthenticatedRateLimit = (credentialId: string, now?: number) => {
    consumeAuthenticatedRateLimitCalls.push(credentialId);
    return overrides.consumeAuthenticatedRateLimit
      ? overrides.consumeAuthenticatedRateLimit(credentialId, now)
      : { allowed: true as const };
  };
  const recordCredentialUse = async (id: string, now?: number) => {
    recordCredentialUseCalls.push(id);
    if (overrides.recordCredentialUse) await overrides.recordCredentialUse(id, now);
  };

  return {
    verifyCredential,
    consumeAuthenticatedRateLimit,
    recordCredentialUse,
    verifyCredentialCalls,
    consumeAuthenticatedRateLimitCalls,
    recordCredentialUseCalls,
  };
}

test("a missing marker never calls verifyCredential, the authenticated limiter, or recordCredentialUse", async () => {
  const spies = spyDeps();
  const authorizer = createClientAuthorizer({
    verifyCredential: spies.verifyCredential,
    consumeAuthenticatedRateLimit: spies.consumeAuthenticatedRateLimit,
    recordCredentialUse: spies.recordCredentialUse,
  });

  const result = await authorizer(requestWith({ marker: "guessed-value", authorization: "Bearer irrelevant-token" }), "chat:read");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 403);

  assert.deepEqual(spies.verifyCredentialCalls, [], "verifyCredential must not be called before the marker verifies");
  assert.deepEqual(
    spies.consumeAuthenticatedRateLimitCalls,
    [],
    "the authenticated limiter must not be called before the marker verifies",
  );
  assert.deepEqual(
    spies.recordCredentialUseCalls,
    [],
    "recordCredentialUse must not be called before the marker verifies",
  );
});

test("a missing/malformed bearer (correct marker) never calls verifyCredential or anything downstream", async () => {
  const spies = spyDeps();
  const authorizer = createClientAuthorizer({
    verifyCredential: spies.verifyCredential,
    consumeAuthenticatedRateLimit: spies.consumeAuthenticatedRateLimit,
    recordCredentialUse: spies.recordCredentialUse,
  });

  const result = await authorizer(requestWith({ authorization: null }), "chat:read");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 401);

  assert.deepEqual(spies.verifyCredentialCalls, [], "verifyCredential must not be called without a syntactically valid bearer");
  assert.deepEqual(spies.consumeAuthenticatedRateLimitCalls, []);
  assert.deepEqual(spies.recordCredentialUseCalls, []);
});

test("an invalid token calls verifyCredential but never the authenticated limiter or recordCredentialUse", async () => {
  const spies = spyDeps({ verifyCredential: async () => null });
  const authorizer = createClientAuthorizer({
    verifyCredential: spies.verifyCredential,
    consumeAuthenticatedRateLimit: spies.consumeAuthenticatedRateLimit,
    recordCredentialUse: spies.recordCredentialUse,
  });

  const result = await authorizer(requestWith({ authorization: "Bearer bogus-token" }), "chat:read");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 401);

  assert.deepEqual(spies.verifyCredentialCalls, ["bogus-token"], "verifyCredential is called once the marker and bearer are valid");
  assert.deepEqual(
    spies.consumeAuthenticatedRateLimitCalls,
    [],
    "the authenticated limiter must never be reached for a token that fails verification",
  );
  assert.deepEqual(
    spies.recordCredentialUseCalls,
    [],
    "recordCredentialUse must never be called for a token that fails verification",
  );
});

test("an under-scoped credential never calls the authenticated limiter or recordCredentialUse", async () => {
  const credential = {
    id: "cred-under-scoped",
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read" as const],
    createdAt: 1_000,
    lastUsedAt: null,
    revokedAt: null,
  };
  const spies = spyDeps({ verifyCredential: async () => credential });
  const authorizer = createClientAuthorizer({
    verifyCredential: spies.verifyCredential,
    consumeAuthenticatedRateLimit: spies.consumeAuthenticatedRateLimit,
    recordCredentialUse: spies.recordCredentialUse,
  });

  const result = await authorizer(requestWith({ authorization: "Bearer scoped-token" }), "chat:write");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 403);

  assert.deepEqual(spies.verifyCredentialCalls, ["scoped-token"]);
  assert.deepEqual(
    spies.consumeAuthenticatedRateLimitCalls,
    [],
    "the authenticated limiter must never be reached for a credential missing the required scope",
  );
  assert.deepEqual(
    spies.recordCredentialUseCalls,
    [],
    "recordCredentialUse must never be called for a credential missing the required scope",
  );
});

test("a credential missing one of multiple required scopes never calls the authenticated limiter or recordCredentialUse", async () => {
  const credential = {
    id: "cred-missing-one-scope",
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:write" as const],
    createdAt: 1_000,
    lastUsedAt: null,
    revokedAt: null,
  };
  const spies = spyDeps({ verifyCredential: async () => credential });
  const authorizer = createClientAuthorizer({
    verifyCredential: spies.verifyCredential,
    consumeAuthenticatedRateLimit: spies.consumeAuthenticatedRateLimit,
    recordCredentialUse: spies.recordCredentialUse,
  });

  const result = await authorizer(
    requestWith({ authorization: "Bearer scoped-token" }),
    ["chat:write", "tasks:write"],
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 403);

  assert.deepEqual(spies.verifyCredentialCalls, ["scoped-token"]);
  assert.deepEqual(
    spies.consumeAuthenticatedRateLimitCalls,
    [],
    "the authenticated limiter must never be reached for a credential missing any required scope",
  );
  assert.deepEqual(
    spies.recordCredentialUseCalls,
    [],
    "recordCredentialUse must never be called for a credential missing any required scope",
  );
});

test("a rate-limited credential never calls recordCredentialUse", async () => {
  const credential = {
    id: "cred-rate-limited",
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read" as const],
    createdAt: 1_000,
    lastUsedAt: null,
    revokedAt: null,
  };
  const spies = spyDeps({
    verifyCredential: async () => credential,
    consumeAuthenticatedRateLimit: () => ({ allowed: false, retryAfterSeconds: 5 }),
  });
  const authorizer = createClientAuthorizer({
    verifyCredential: spies.verifyCredential,
    consumeAuthenticatedRateLimit: spies.consumeAuthenticatedRateLimit,
    recordCredentialUse: spies.recordCredentialUse,
  });

  const result = await authorizer(requestWith({ authorization: "Bearer good-token" }), "chat:read");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 429);

  assert.deepEqual(spies.consumeAuthenticatedRateLimitCalls, ["cred-rate-limited"]);
  assert.deepEqual(
    spies.recordCredentialUseCalls,
    [],
    "recordCredentialUse must never be called once the authenticated limiter rejects the request",
  );
});

test("recordCredentialUse is called only once identity, scope, and the authenticated limit all pass", async () => {
  const credential = {
    id: "cred-all-pass",
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read" as const],
    createdAt: 1_000,
    lastUsedAt: null,
    revokedAt: null,
  };
  const spies = spyDeps({ verifyCredential: async () => credential });
  const authorizer = createClientAuthorizer({
    verifyCredential: spies.verifyCredential,
    consumeAuthenticatedRateLimit: spies.consumeAuthenticatedRateLimit,
    recordCredentialUse: spies.recordCredentialUse,
  });

  const result = await authorizer(requestWith({ authorization: "Bearer good-token" }), "chat:read");
  assert.equal(result.ok, true);

  assert.deepEqual(spies.verifyCredentialCalls, ["good-token"]);
  assert.deepEqual(spies.consumeAuthenticatedRateLimitCalls, ["cred-all-pass"]);
  assert.deepEqual(
    spies.recordCredentialUseCalls,
    ["cred-all-pass"],
    "recordCredentialUse is called exactly once all prior checks pass",
  );
});

// ─── authenticated rate limit, keyed by credential id ─────────────────────

test("the authenticated rate limit rejects the 121st request for the same credential within 60s, with Retry-After", async () => {
  const { token } = await issueCredential(approvedPairing(), 1_000);
  let now = 10_000;
  const authorizer = createClientAuthorizer({ now: () => now });

  for (let i = 0; i < 120; i++) {
    const req = requestWith({ authorization: `Bearer ${token}` });
    const result = await authorizer(req, "chat:read");
    assert.equal(result.ok, true, `request ${i + 1} of 120 should succeed`);
  }

  const req = requestWith({ authorization: `Bearer ${token}` });
  const result = await authorizer(req, "chat:read");
  assert.equal(result.ok, false, "the 121st request within the window must be rejected");
  if (result.ok) return;
  assert.equal(result.response.status, 429);
  const body = await readErrorBody(result.response);
  assert.equal(body.error.code, "rate_limited");
  assert.equal(body.error.retryable, true);
  const retryAfter = result.response.headers.get("Retry-After");
  assert.ok(retryAfter, "a Retry-After header must be present");
  assert.ok(Number(retryAfter) >= 1, "Retry-After must be a positive integer number of seconds");

  // Advancing well past the window lets the credential through again.
  now += 60_000;
  const afterReset = await authorizer(requestWith({ authorization: `Bearer ${token}` }), "chat:read");
  assert.equal(afterReset.ok, true, "the window resets after 60s");
});

// ─── lastUsedAt updated / throttled ────────────────────────────────────────

test("a successful authorization records lastUsedAt, throttled the same way recordCredentialUse is", async () => {
  const { token, credential } = await issueCredential(approvedPairing(), 1_000);
  let now = 10_000;
  const authorizer = createClientAuthorizer({ now: () => now });
  const { listCredentials } = await import("./credential-store.ts");

  assert.equal(credential.lastUsedAt, null);

  const first = await authorizer(requestWith({ authorization: `Bearer ${token}` }), "chat:read");
  assert.equal(first.ok, true);
  let stored = (await listCredentials()).find((c) => c.id === credential.id);
  assert.equal(stored?.lastUsedAt, 10_000, "the first successful use records lastUsedAt");

  now += 1; // well under the 60s write threshold
  const second = await authorizer(requestWith({ authorization: `Bearer ${token}` }), "chat:read");
  assert.equal(second.ok, true);
  stored = (await listCredentials()).find((c) => c.id === credential.id);
  assert.equal(stored?.lastUsedAt, 10_000, "a use within the throttle window must not advance lastUsedAt");

  now = 10_000 + 60_000;
  const third = await authorizer(requestWith({ authorization: `Bearer ${token}` }), "chat:read");
  assert.equal(third.ok, true);
  stored = (await listCredentials()).find((c) => c.id === credential.id);
  assert.equal(stored?.lastUsedAt, 10_000 + 60_000, "a use at/after the throttle window does advance lastUsedAt");
});

// ─── record-use persistence failure -> still authenticates, logs, never swallows ──

test("a recordCredentialUse failure never fails an otherwise-successful authorization, and logs only a fixed, secret-free diagnostic", async () => {
  // The thrown error's own message is deliberately crafted to contain
  // token-and-credential-id-shaped secrets — a naive `error.message` or
  // `String(error)` interpolation would leak them into the log. The fixed
  // diagnostic must never surface any of this.
  const { token, credential } = await issueCredential(approvedPairing(), 1_000);
  const secretLookingMessage = `disk write failed for token=${token} credentialId=${credential.id} secret=super-secret-value-do-not-log`;
  const authorizer = createClientAuthorizer({
    recordCredentialUse: async () => {
      throw new Error(secretLookingMessage);
    },
  });

  const originalConsoleError = console.error;
  const loggedCalls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    loggedCalls.push(args);
  };
  let result: Awaited<ReturnType<typeof authorizer>>;
  try {
    result = await authorizer(requestWith({ authorization: `Bearer ${token}` }), "chat:read");
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(
    result.ok,
    true,
    "last-used bookkeeping is informational only — a write failure must never un-authenticate an already-verified credential",
  );
  if (!result.ok) return;
  assert.equal(result.principal.credentialId, credential.id);

  assert.equal(loggedCalls.length, 1, "the failure must never be silently swallowed — exactly one diagnostic is logged");
  const loggedText = loggedCalls[0].map(String).join(" ");
  assert.match(loggedText, /recordCredentialUse failed/);

  // The diagnostic must be a FIXED string — never the thrown error's own
  // message, never `String(error)`, never the bearer token, its hash, or the
  // credential id, and never any other value derived from the failure.
  assert.doesNotMatch(loggedText, /simulated|disk write failed/, "the thrown error's own message must never be interpolated");
  assert.doesNotMatch(loggedText, new RegExp(token), "the diagnostic must never contain the bearer token");
  assert.doesNotMatch(loggedText, new RegExp(credential.id), "the diagnostic must never contain the credential id");
  assert.doesNotMatch(loggedText, /super-secret-value-do-not-log/, "the diagnostic must never contain the thrown error's message");
});

test("a recordCredentialUse failure whose thrown value is not an Error still logs only the fixed diagnostic", async () => {
  // A thrown non-Error value (e.g. a raw string or object) must not leak
  // via `String(error)` either — the diagnostic is fixed regardless of what
  // was thrown.
  const { token, credential } = await issueCredential(approvedPairing(), 1_000);
  const secretLookingThrown = `token=${token} credentialId=${credential.id}`;
  const authorizer = createClientAuthorizer({
    recordCredentialUse: async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw secretLookingThrown;
    },
  });

  const originalConsoleError = console.error;
  const loggedCalls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    loggedCalls.push(args);
  };
  let result: Awaited<ReturnType<typeof authorizer>>;
  try {
    result = await authorizer(requestWith({ authorization: `Bearer ${token}` }), "chat:read");
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(loggedCalls.length, 1);
  const loggedText = loggedCalls[0].map(String).join(" ");
  assert.match(loggedText, /recordCredentialUse failed/);
  assert.doesNotMatch(loggedText, new RegExp(token), "a thrown non-Error value's contents must never leak via String(error)");
  assert.doesNotMatch(loggedText, new RegExp(credential.id));
});

console.log("client-v1 auth.test.ts: ok");
