import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { LOCAL_PEER_HEADER } from "../../../proxy-helpers.ts";
import { CLIENT_V1_LIMITS } from "./contract.ts";
import { encodeClientV1Cursor } from "./pagination.ts";
import {
  CLIENT_V1_INVALID_BEARER_LIMIT,
  CLIENT_V1_AUTHENTICATED_LIMIT,
} from "./rate-limit.ts";
import {
  CLIENT_V1_READ_SCOPE,
  assertClientV1NoReadQuery,
  chargeClientV1AuthFailure,
  clientV1BearerFrom,
  clientV1InvalidReadRequest,
  parseClientV1ReadPage,
} from "./read-guard.ts";
import { createClientV1Runtime } from "./runtime.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-read-guard-");

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3020/api/client/v1/projects", { headers });
}

test("the bearer is read only from a well-formed Authorization header", () => {
  assert.equal(clientV1BearerFrom(request()), null);
  assert.equal(clientV1BearerFrom(request({ authorization: "Bearer token-1" })), "token-1");
  // Scheme matching is case-insensitive per RFC 7235, and any run of spaces or
  // tabs separates it from the credential.
  assert.equal(clientV1BearerFrom(request({ authorization: "bearer token-1" })), "token-1");
  assert.equal(clientV1BearerFrom(request({ authorization: "BEARER \t token-1" })), "token-1");
  for (const malformed of [
    "",
    "token-1",
    "Basic token-1",
    "Bearer",
    "Bearer ",
    "Bearer token-1 token-2",
    "Bearerish token-1",
    `Bearer ${"x".repeat(513)}`,
  ]) {
    assert.equal(clientV1BearerFrom(request({ authorization: malformed })), null, malformed);
  }
});

test("read query parameters default, bound, and refuse what they do not serve", () => {
  const at = (query: string) =>
    parseClientV1ReadPage(new URL(`http://127.0.0.1:3020/api/client/v1/projects${query}`));

  assert.deepEqual(at(""), { limit: CLIENT_V1_LIMITS.defaultPageSize, after: null });
  assert.deepEqual(at("?limit=7"), { limit: 7, after: null });

  const cursor = encodeClientV1Cursor({ sort: "2026-08-01T00:00:00.000Z", id: "p1" });
  assert.deepEqual(at(`?cursor=${cursor}`), {
    limit: CLIENT_V1_LIMITS.defaultPageSize,
    after: { sort: "2026-08-01T00:00:00.000Z", id: "p1" },
  });

  assert.throws(() => at(`?limit=${CLIENT_V1_LIMITS.maxPageSize + 1}`), /limit/i);
  assert.throws(() => at("?cursor=not%2Ba%2Bcursor"), /cursor/i);
  // A parameter the route does not serve is a client bug, and answering it
  // with the default page is how `?limt=5` silently becomes fifty rows.
  assert.throws(() => at("?limt=5"), /do not support the "limt" parameter/);
  // Repeating a supported parameter is equally ambiguous: URLSearchParams.get
  // would quietly pick the first and discard the second.
  assert.throws(() => at("?limit=5&limit=9"), /once/i);
});

test("a single-record read serves no query parameters at all", () => {
  const at = (query: string) =>
    assertClientV1NoReadQuery(
      new URL(`http://127.0.0.1:3020/api/client/v1/conversations/conversation-1${query}`),
    );
  assert.doesNotThrow(() => at(""));
  // Including the two the list routes DO serve: there is nothing here to page.
  for (const query of ["?limit=5", "?cursor=abc", "?offset=1", "?limit="]) {
    assert.throws(() => at(query), /do not support/, query);
  }
});

test("a refused query becomes a 400 that names the parameter at fault", async () => {
  const response = clientV1InvalidReadRequest(
    new Error("Client v1 read requests do not support the \"limt\" parameter."),
  );
  assert.equal(response.status, 400);
  const body = await response.json() as {
    error: { code: string; retryable: boolean; details: { reason: string } };
  };
  assert.equal(body.error.code, "invalid_request");
  // Never retryable: the same request will be refused the same way forever.
  assert.equal(body.error.retryable, false);
  assert.match(body.error.details.reason, /"limt"/);

  // The detail budget is 256 characters and the error builder throws above it,
  // so an over-long message must be truncated rather than turned into a 500.
  const truncated = clientV1InvalidReadRequest(new Error("x".repeat(4_000)));
  assert.equal(truncated.status, 400);
  const truncatedBody = await truncated.json() as { error: { details: { reason: string } } };
  assert.equal(
    truncatedBody.error.details.reason.length,
    CLIENT_V1_LIMITS.errorDetailValueCharacters,
  );

  // A non-Error rejection must still produce an envelope, not throw a second
  // time on `cause.message`.
  assert.equal(clientV1InvalidReadRequest("nope").status, 400);
});

test("an unauthorized failure is charged to the invalid-bearer budget", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({ credentialRoot: root, loopbackSecret: "stamp" });
    const failure = await runtime.authenticator.requireScope({
      bearer: null,
      scope: CLIENT_V1_READ_SCOPE,
    });
    assert.equal(failure.ok, false);
    if (failure.ok) return;

    let response: Response | null = null;
    for (let attempt = 0; attempt < CLIENT_V1_INVALID_BEARER_LIMIT; attempt += 1) {
      response = chargeClientV1AuthFailure(runtime, failure, "stamp");
      assert.equal(response.status, 401, `attempt ${attempt}`);
    }
    // The budget is spent by wrong credentials, so the next one is refused
    // before it can be a guess at all.
    response = chargeClientV1AuthFailure(runtime, failure, "stamp");
    assert.equal(response!.status, 429);
    const body = await response!.json() as { error: { code: string; details: { limit: string } } };
    assert.equal(body.error.code, "rate_limited");
    assert.equal(body.error.details.limit, String(CLIENT_V1_INVALID_BEARER_LIMIT));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a scope denial is charged to the credential's own authenticated budget", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({ credentialRoot: root, loopbackSecret: "stamp" });
    const issued = await runtime.credentialStore.issue({
      appName: "OpenCoven Chat",
      installationId: "chat-install-1",
      scopes: ["chat:write"],
    });
    const failure = await runtime.authenticator.requireScope({
      bearer: issued.bearer,
      scope: CLIENT_V1_READ_SCOPE,
    });
    assert.equal(failure.ok, false);
    if (failure.ok) return;
    assert.equal(failure.reason, "scope_denied");

    for (let attempt = 0; attempt < CLIENT_V1_AUTHENTICATED_LIMIT; attempt += 1) {
      assert.equal(chargeClientV1AuthFailure(runtime, failure, "stamp").status, 403);
    }
    assert.equal(chargeClientV1AuthFailure(runtime, failure, "stamp").status, 429);
    // Charging the wrong bucket would have been invisible: both refusals look
    // the same from outside. The invalid-bearer budget must be untouched.
    assert.equal(runtime.rateLimiter.consumeInvalidBearer("stamp").allowed, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("the read scope is the only read grant the contract publishes", () => {
  // Every canonical read here is gated on one scope. Stated as an assertion
  // because the routes name the constant, not the string, and a silent change
  // to it would widen or narrow four routes at once.
  assert.equal(CLIENT_V1_READ_SCOPE, "chat:read");
});

test("the loopback stamp header the routes require is the server-stamped one", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({ credentialRoot: root, loopbackSecret: "stamp" });
    assert.equal(runtime.authenticator.isTrustedLoopback("stamp"), true);
    assert.equal(runtime.authenticator.isTrustedLoopback("not-the-stamp"), false);
    assert.equal(runtime.authenticator.isTrustedLoopback(null), false);
    assert.equal(LOCAL_PEER_HEADER, "x-coven-cave-local-peer");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
